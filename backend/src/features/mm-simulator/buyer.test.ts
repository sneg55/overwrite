import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import {
  allocateStrikeFor,
  type MmConfig,
  type MmOption,
  parseMmOptions,
  payPremiumFor,
} from './buyer'

const cfg: MmConfig = {
  mmBuyer: 'mm',
  operator: 'operator',
  cashInstrument: 'mUSDC',
  pollMs: 2_000,
}

const writtenOption: MmOption = {
  cid: '00o',
  state: 'Written',
  premiumUsdc: '300.0',
  strike: '66000.0',
  expiryMs: 0,
  notionalCbtc: '3.0',
}

describe('payPremiumFor', () => {
  test('splits the MM funded balance to exactly the premium, then pays as mmBuyer', async () => {
    const calls: Array<{
      choice: string
      choiceArgument: Record<string, unknown>
      actAs: string[]
    }> = []
    const session = {
      query: (_p: string, _m: string) => [
        { contractId: '00fund', payload: { owner: 'mm', instrument: 'mUSDC', amount: '100000.0' } },
      ],
      exercise: (a: {
        choice: string
        choiceArgument: Record<string, unknown>
        actAs: string[]
      }) => {
        calls.push({ choice: a.choice, choiceArgument: a.choiceArgument, actAs: a.actAs })
        if (a.choice === 'Split')
          return {
            created: [
              { templateId: 'p:Overwrite.Allocation:Holding', contractId: 'premCid', payload: {} },
              { templateId: 'p:Overwrite.Allocation:Holding', contractId: 'remCid', payload: {} },
            ],
            exerciseResult: null,
          }
        return { created: [], exerciseResult: null }
      },
    }
    await payPremiumFor(session as never, cfg, writtenOption)
    expect(calls.find((c) => c.choice === 'Split')?.choiceArgument.splitAmount).toBe('300.0')
    const pay = calls.find((c) => c.choice === 'PayPremium')
    expect(pay?.choiceArgument.premiumCid).toBe('premCid')
    expect(pay?.actAs).toEqual(['mm'])
  })

  test('throws MM_NO_FUNDS when the MM cannot cover the premium', async () => {
    const session = {
      query: () => [
        { contractId: '00fund', payload: { owner: 'mm', instrument: 'mUSDC', amount: '10.0' } },
      ],
      exercise: () => ({ created: [], exerciseResult: null }),
    }
    // eslint-disable-next-line @typescript-eslint/await-thenable -- bun-types types rejects.toThrow() as non-thenable, but it must be awaited at runtime
    await expect(payPremiumFor(session as never, cfg, writtenOption)).rejects.toThrow('E_MM_001')
  })
})

describe('allocateStrikeFor', () => {
  // strike 66000 * notional 3.0 = 198000 strike cash.
  const itmOption: MmOption = {
    cid: '00o',
    state: 'Active',
    premiumUsdc: '300.0',
    strike: '66000.0',
    expiryMs: 0,
    notionalCbtc: '3.0',
  }

  function makeSession(existingAllocations: ActiveContract[]): {
    session: unknown
    choices: string[]
  } {
    const choices: string[] = []
    const session = {
      query: (_p: string, m: string, t: string) => {
        if (m === 'Allocation' && t === 'MockAllocation') return existingAllocations
        if (m === 'Allocation' && t === 'Holding')
          return [
            {
              contractId: '00fund',
              payload: { owner: 'mm', instrument: 'mUSDC', amount: '1000000.0' },
            },
          ]
        return []
      },
      exercise: (a: { choice: string }) => {
        choices.push(a.choice)
        if (a.choice === 'Split')
          return {
            created: [
              { templateId: 'p:Overwrite.Allocation:Holding', contractId: 'chunk', payload: {} },
              { templateId: 'p:Overwrite.Allocation:Holding', contractId: 'rest', payload: {} },
            ],
            exerciseResult: null,
          }
        return { created: [], exerciseResult: null }
      },
    }
    return { session, choices }
  }

  test('allocates strike cash and reports true when none exists yet', async () => {
    const { session, choices } = makeSession([])
    const allocated = await allocateStrikeFor(session as never, cfg, itmOption)
    expect(choices).toContain('Allocate')
    expect(allocated).toBe(true)
  })

  test('skips and reports false when a matching strike-cash allocation already exists', async () => {
    const existing: ActiveContract[] = [
      { contractId: '00a', payload: { sender: 'mm', instrument: 'mUSDC', amount: '198000.0' } },
    ]
    const { session, choices } = makeSession(existing)
    const allocated = await allocateStrikeFor(session as never, cfg, itmOption)
    expect(choices).not.toContain('Allocate')
    expect(allocated).toBe(false)
  })
})

describe('parseMmOptions', () => {
  test('maps option fields the MM cares about', () => {
    const opts = parseMmOptions([
      {
        contractId: '00o',
        payload: {
          state: 'Written',
          premiumUsdc: '300.0',
          strikeUsdcPerCbtc: '66000.0',
          expiry: '2026-07-10T00:00:00Z',
          notionalCbtc: '3.0',
        },
      },
    ])
    expect(opts[0]?.strike).toBe('66000.0')
    expect(opts[0]?.state).toBe('Written')
  })
})
