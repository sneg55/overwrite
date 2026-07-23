// Registry-mode settle tests: each leg's choice context is fetched from the registry
// and the disclosed contracts ride on the submission. Split from handlers-settle.test.ts.

import { describe, expect, test } from 'bun:test'
import type { HandlerCtx } from './handlers'
import { settle } from './handlers-settle'
import { base, cfg, recorder } from './handlers-settle-fixtures'
import type { TickReads } from './reads'

describe('settle in registry mode', () => {
  const registryCfg = { ...cfg, useRealRegistry: true }
  const disclosed = [
    {
      templateId: 'reg:Allocation',
      contractId: '00disclosed',
      createdEventBlob: 'blob',
      synchronizerId: 'sync',
    },
  ]
  function stubRegistry(): { port: { allocationContext: unknown }; choices: string[] } {
    const choices: string[] = []
    return {
      choices,
      port: {
        allocationContext: (_url: string, _registrar: string, _cid: string, choice: string) => {
          choices.push(choice)
          return Promise.resolve({
            contextValues: { key: 'value' },
            disclosedContracts: disclosed,
          })
        },
      },
    }
  }

  test('ITM fetches the execute-transfer context and attaches disclosed contracts', async () => {
    const rec = recorder()
    const stub = stubRegistry()
    const reads: TickReads = {
      ...base,
      optionCid: '00o',
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '70000.0',
      cashAllocCid: '00cash',
      allocationCid: '00collateral',
    }
    await settle({
      session: rec.session,
      reads,
      cfg: registryCfg,
      registry: stub.port,
    } as unknown as HandlerCtx)

    expect(stub.choices).toEqual(['execute-transfer'])
    expect(rec.calls[0]?.choice).toBe('SettleITM')
    expect(rec.calls[0]?.choiceArgument.cbtcContext).toEqual({
      context: { values: { key: 'value' } },
      meta: { values: {} },
    })
    // The cash leg is still mock USDC, so it carries an empty context.
    expect(rec.calls[0]?.choiceArgument.cashContext).toEqual({
      context: { values: {} },
      meta: { values: {} },
    })
    expect(rec.calls[0]?.disclosed).toEqual(disclosed)
  })

  test('OTM fetches the withdraw context, not execute-transfer', async () => {
    const rec = recorder()
    const stub = stubRegistry()
    const reads: TickReads = {
      ...base,
      optionCid: '00o',
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '60000.0',
      allocationCid: '00collateral',
    }
    await settle({
      session: rec.session,
      reads,
      cfg: registryCfg,
      registry: stub.port,
    } as unknown as HandlerCtx)

    // The registry issues a different context per choice; withdrawing collateral
    // with an execute-transfer context would be rejected.
    expect(stub.choices).toEqual(['withdraw'])
    expect(rec.calls[0]?.choice).toBe('SettleOTM')
    expect(rec.calls[0]?.disclosed).toEqual(disclosed)
  })
})
