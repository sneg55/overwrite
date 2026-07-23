import { describe, expect, test } from 'bun:test'
import { runOnce, type SchedulerHandlers } from './runner'
import type { EpochSnapshot } from './state-machine'

const base: EpochSnapshot = {
  windowState: 'Open',
  now: 3_000,
  depositWindowClosesAt: 2_000,
  expiry: 5_000,
  depositCount: 3,
  collateralLocked: false,
  optionWritten: false,
  premiumPaid: false,
  premiumDistributed: false,
  settled: false,
  epochRecorded: false,
}

function spyHandlers(): { handlers: SchedulerHandlers; calls: string[] } {
  const calls: string[] = []
  const mk = (name: string) => (): Promise<void> => {
    calls.push(name)
    return Promise.resolve()
  }
  return {
    calls,
    handlers: {
      OpenDeposits: mk('OpenDeposits'),
      LockCollateral: mk('LockCollateral'),
      WriteCall: mk('WriteCall'),
      DistributePremium: mk('DistributePremium'),
      Settle: mk('Settle'),
      RecordEpoch: mk('RecordEpoch'),
      Roll: mk('Roll'),
    },
  }
}

describe('runOnce', () => {
  test('dispatches the command for a command action', async () => {
    const s = spyHandlers()
    const r = await runOnce(base, s.handlers) // window closed + deposits -> LockCollateral
    expect(r.action).toBe('LockCollateral')
    expect(r.dispatched).toBe(true)
    expect(s.calls).toEqual(['LockCollateral'])
  })

  test('dispatches Settle at expiry', async () => {
    const s = spyHandlers()
    const snap = {
      ...base,
      now: 6_000,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
      premiumDistributed: true,
    }
    const r = await runOnce(snap, s.handlers)
    expect(r.action).toBe('Settle')
    expect(s.calls).toEqual(['Settle'])
  })

  test('does not dispatch on a passive Await action', async () => {
    const s = spyHandlers()
    const snap = { ...base, now: 1_500 } // window still open -> AwaitDeposits
    const r = await runOnce(snap, s.handlers)
    expect(r.action).toBe('AwaitDeposits')
    expect(r.dispatched).toBe(false)
    expect(s.calls).toEqual([])
  })
})
