import { describe, expect, test } from 'bun:test'
import type { HandlerCtx } from './handlers'
import { recordEpoch, roll, settle } from './handlers-settle'
import { base, cfg, recorder } from './handlers-settle-fixtures'
import type { TickReads } from './reads'

describe('settle', () => {
  test('price <= strike settles OTM', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      optionCid: '00o',
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '60000.0',
    }
    await settle({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls[0]?.choice).toBe('SettleOTM')
    expect(rec.calls[0]?.choiceArgument.obsCid).toBe('00obs')
  })

  test('price > strike with allocated cash settles ITM', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      optionCid: '00o',
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '70000.0',
      cashAllocCid: '00cash',
    }
    await settle({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls).toHaveLength(1)
    expect(rec.calls[0]?.contractId).toBe('00o')
    expect(rec.calls[0]?.choice).toBe('SettleITM')
    // Mock mode (useRealRegistry false): both legs carry an empty choice context,
    // which the local MockAllocation ignores.
    expect(rec.calls[0]?.choiceArgument).toEqual({
      obsCid: '00obs',
      cashAllocationCid: '00cash',
      cbtcContext: { context: { values: {} }, meta: { values: {} } },
      cashContext: { context: { values: {} }, meta: { values: {} } },
    })
  })

  test('price > strike without allocated cash waits', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      optionCid: '00o',
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '70000.0',
    }
    await settle({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls).toHaveLength(0)
  })

  test('missing option cid waits', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      optionStrike: '66000.0',
      settleObsCid: '00obs',
      settleObsPrice: '70000.0',
      cashAllocCid: '00cash',
    }
    await settle({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls).toHaveLength(0)
  })

  test('no valid observation yet: waits (no call)', async () => {
    const rec = recorder()
    const reads: TickReads = { ...base, optionCid: '00o', optionStrike: '66000.0' }
    await settle({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls).toHaveLength(0)
  })
})

describe('recordEpoch', () => {
  test('records by position, receipt, and settlement cids; derives facts on-ledger', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      positions: [
        {
          cid: 'pa',
          depositor: 'alice',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pb',
          depositor: 'bob',
          principalCbtc: '2.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
      ],
      receiptCids: ['ra', 'rb'],
      receiptTotalUsdc: 180,
      settlementCid: '00settlement',
      settlementPath: 'OTM',
      settlementCollateralReturned: true,
    }
    await recordEpoch({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const call = rec.calls.find((c) => c.choice === 'RecordEpoch')
    expect(call?.choiceArgument.positionCids).toEqual(['pa', 'pb'])
    expect(call?.choiceArgument.receiptCids).toEqual(['ra', 'rb'])
    expect(call?.choiceArgument.settlementCid).toBe('00settlement')
    expect(call?.choiceArgument.settlementPath).toBeUndefined()
    expect(call?.choiceArgument.collateralReturned).toBeUndefined()
    expect(call?.choiceArgument.tsSettled).toBeUndefined()
    // The choice derives these on-ledger; the handler must NOT pass them.
    expect(call?.choiceArgument.depositors).toBeUndefined()
    expect(call?.choiceArgument.totalNotionalCbtc).toBeUndefined()
    expect(call?.choiceArgument.totalPremiumUsdc).toBeUndefined()
  })
})

describe('roll', () => {
  test('rolls the batch via one Vault.RollPositions on the OTM path', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...base,
      isLeftover: true,
      positions: [
        {
          cid: 'pa',
          depositor: 'alice',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
      ],
      settlementCid: '00settlement',
      settlementPath: 'OTM',
      poolHoldingCid: '00pool',
    }
    await roll({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    expect(rec.calls).toHaveLength(1)
    const call = rec.calls[0]
    expect(call?.choice).toBe('RollPositions')
    expect(call?.module).toBe('Vault')
    expect(call?.template).toBe('Vault')
    expect(call?.choiceArgument.positionCids).toEqual(['pa'])
    expect(call?.choiceArgument.settlementCid).toBe('00settlement')
    expect(call?.choiceArgument.settlementPath).toBeUndefined()
    expect(call?.choiceArgument.poolCid).toBe('00pool')
    expect(call?.choiceArgument.proceedsCid).toBeNull()
  })
})
