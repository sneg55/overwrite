import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import type { MmConfig } from './buyer'
import { runMm } from './loop'

const cfg: MmConfig = { mmBuyer: 'mm', operator: 'operator', cashInstrument: 'mUSDC', pollMs: 5 }

describe('runMm', () => {
  test('pays premium on a Written option, then stops on abort', async () => {
    const paid: string[] = []
    const session = {
      query: (_p: string, m: string) => {
        if (m === 'CallOption')
          return [
            {
              contractId: '00o',
              payload: {
                state: 'Written',
                premiumUsdc: '300.0',
                strikeUsdcPerCbtc: '66000.0',
                expiry: '2030-01-01T00:00:00Z',
                notionalCbtc: '3.0',
              },
            },
          ]
        return [
          {
            contractId: '00fund',
            payload: { owner: 'mm', instrument: 'mUSDC', amount: '100000.0' },
          },
        ]
      },
      exercise: (a: { choice: string }) => {
        if (a.choice === 'PayPremium') paid.push('00o')
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
    const ac = new AbortController()
    let done = false
    await new Promise<void>((resolve) => {
      void runMm(session as never, cfg, ac.signal, (action) => {
        if (!done && action === 'PayPremium') {
          done = true
          ac.abort()
          resolve()
        }
      })
    })
    expect(paid).toContain('00o')
  })

  test('in demo mode, decides exercise from the schedule and allocates strike cash', async () => {
    // Strike far above any live BTC spot, so the ONLY way to reach an exercise is the
    // demo schedule (late 2,000,000 > strike 1,000,000). If the loop still read live
    // spot it would walk, and no AllocateStrike would ever fire.
    const itmCfg: MmConfig = {
      mmBuyer: 'mm',
      operator: 'operator',
      cashInstrument: 'mUSDC',
      pollMs: 5,
      demoPrice: '900000.0',
      demoLate: '2000000.0',
      demoSwitchMs: 0,
    }
    const actions: string[] = []
    const session = {
      query: (_p: string, m: string, t: string) => {
        if (m === 'CallOption')
          return [
            {
              contractId: '00o',
              payload: {
                state: 'Active',
                premiumUsdc: '300.0',
                strikeUsdcPerCbtc: '1000000.0',
                expiry: '2000-01-01T00:00:00Z',
                notionalCbtc: '1.0',
              },
            },
          ]
        if (m === 'Allocation' && t === 'MockAllocation') return []
        return [
          {
            contractId: '00fund',
            payload: { owner: 'mm', instrument: 'mUSDC', amount: '5000000.0' },
          },
        ]
      },
      exercise: (a: { choice: string }) => {
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
    const ac = new AbortController()
    let done = false
    const settle = (resolve: () => void): void => {
      if (!done) {
        done = true
        ac.abort()
        resolve()
      }
    }
    await new Promise<void>((resolve) => {
      void runMm(session as never, itmCfg, ac.signal, (action) => {
        actions.push(action)
        if (action === 'AllocateStrike') settle(resolve)
      })
      setTimeout(() => settle(resolve), 1_500)
    })
    expect(actions).toContain('AllocateStrike')
  })
})
