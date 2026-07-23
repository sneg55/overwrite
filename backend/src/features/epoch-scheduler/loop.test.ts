import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import type { SchedulerConfig } from './config'
import { makeEngineControl } from './control'
import { runScheduler } from './loop'

const cfg: SchedulerConfig = {
  operator: 'operator',
  oracle: 'oracle',
  mmBuyer: 'mm',
  cashInstrument: 'mUSDC',
  epochLengthMs: 20_000,
  depositWindowMs: 0,
  tickMs: 5,
  premiumBps: 100,
  allocateWindowMs: 86_400_000,
  settleBufferMs: 3_600_000,
  useRealRegistry: false,
  registryUrl: 'https://registry.test',
  registrar: 'registrar',
}

function fakeConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return { ...cfg, ...overrides }
}

// A ledger session whose reads are fixed, so every tick recomputes the same action.
// Pass an array to capture the choices the loop exercised.
function fakeSession(exercises: string[] = []): unknown {
  return {
    ledgerEnd: () => Promise.resolve(1),
    queryAt: (_offset: number, _p: string, m: string, t: string): ActiveContract[] => {
      if (m === 'Vault')
        return [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Open' } }]
      if (m === 'VaultPosition')
        return [
          {
            contractId: '00p',
            payload: {
              depositor: 'a',
              principalCbtc: '1.0',
              epochNumber: '1',
              withdrawQueued: false,
            },
          },
        ]
      if (m === 'Allocation' && t === 'Holding')
        return [
          {
            contractId: '00pool',
            payload: { owner: 'operator', instrument: 'CBTC', amount: '1.0' },
          },
        ]
      if (m === 'Allocation' && t === 'MockAllocationFactory')
        return [{ contractId: '00factory', payload: { admin: 'cbtc-issuer', user: 'operator' } }]
      return []
    },
    exercise: (a: { choice: string }) => {
      exercises.push(a.choice)
      return { created: [], exerciseResult: null }
    },
  }
}

describe('runScheduler', () => {
  test('runs a tick, dispatches an action, and stops on abort', async () => {
    const exercises: string[] = []
    const session = fakeSession(exercises)
    const ac = new AbortController()
    let done = false
    await new Promise<void>((resolve) => {
      void runScheduler(session as never, fakeConfig(), ac.signal, () => {
        if (!done) {
          done = true
          ac.abort()
          resolve()
        }
      })
    })
    expect(exercises).toContain('LockCollateral')
  })

  test('a paused engine still reads state but dispatches nothing', async () => {
    const control = makeEngineControl(1)
    control.pause()
    const dispatched: string[] = []
    const ctl = new AbortController()
    // Stop after a couple of ticks so the loop terminates.
    setTimeout(() => ctl.abort(), 25)

    await runScheduler(
      fakeSession() as never,
      fakeConfig(),
      ctl.signal,
      (a, d) => {
        if (d) dispatched.push(a)
      },
      control,
    )

    expect(dispatched).toEqual([])
    // The read still happened, so the UI is not frozen while paused.
    expect(control.status().nextAction).not.toBeNull()
  })

  test('one step dispatches exactly one action', async () => {
    const control = makeEngineControl(1)
    control.pause()
    control.requestStep()
    const dispatched: string[] = []
    const ctl = new AbortController()
    setTimeout(() => ctl.abort(), 25)

    await runScheduler(
      fakeSession() as never,
      fakeConfig(),
      ctl.signal,
      (a, d) => {
        if (d) dispatched.push(a)
      },
      control,
    )

    // Exactly one, across however many ticks elapsed before the abort.
    expect(dispatched.length).toBe(1)
  })
})
