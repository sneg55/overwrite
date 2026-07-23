import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import { runOracle } from './loop'
import type { OracleConfig } from './observation-writer'

describe('runOracle (demo-override price)', () => {
  test('publishes the fixed demo price and stops on abort', async () => {
    const cfg: OracleConfig = {
      operator: 'operator',
      oracle: 'oracle',
      pollMs: 5,
      demoPrice: '70000.0',
    }
    const prices: string[] = []
    const session = {
      query: (_p: string, m: string) =>
        m === 'Vault'
          ? [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Locked' } }]
          : [],
      create: (a: { createArguments: Record<string, unknown> }) => {
        prices.push(String(a.createArguments.price))
        return { created: [], exerciseResult: null }
      },
    }
    const ac = new AbortController()
    let done = false
    await new Promise<void>((resolve) => {
      void runOracle(session as never, cfg, ac.signal, (_p, _d, written) => {
        if (!done && written) {
          done = true
          ac.abort()
          resolve()
        }
      })
    })
    expect(prices[0]).toBe('70000.0')
  })

  test('observes the late price once the step has switched', async () => {
    const cfg: OracleConfig = {
      operator: 'operator',
      oracle: 'oracle',
      pollMs: 5,
      demoPrice: '60000.0',
      demoLate: '80000.0',
      demoSwitchMs: 0, // switched from the first tick
    }
    const prices: string[] = []
    const session = {
      query: (_p: string, m: string) =>
        m === 'Vault'
          ? [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Locked' } }]
          : [],
      create: (a: { createArguments: Record<string, unknown> }) => {
        prices.push(String(a.createArguments.price))
        return { created: [], exerciseResult: null }
      },
    }
    const ac = new AbortController()
    let done = false
    await new Promise<void>((resolve) => {
      void runOracle(session as never, cfg, ac.signal, (_p, _d, written) => {
        if (!done && written) {
          done = true
          ac.abort()
          resolve()
        }
      })
    })
    expect(prices[0]).toBe('80000.0')
  })
})
