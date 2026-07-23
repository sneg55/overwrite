import { describe, expect, test } from 'bun:test'
import type { HandlerCtx } from './handlers'
import { makeHandlers } from './make-handlers'
import { runOnce } from './runner'
import type { EpochSnapshot } from './state-machine'

describe('makeHandlers', () => {
  test('dispatches LockCollateral through the wired set', async () => {
    const calls: string[] = []
    const session = {
      exercise: (a: { choice: string }) => {
        calls.push(a.choice)
        return { created: [], exerciseResult: null }
      },
    }
    const reads = {
      now: 5_000,
      vaultCid: '00v',
      vaultEpoch: 1,
      windowState: 'Open',
      workingEpoch: 1,
      isLeftover: false,
      positions: [
        { cid: 'p', depositor: 'a', principalCbtc: '1.0', epochNumber: 1, withdrawQueued: false },
      ],
      allocationPresent: false,
      receiptCids: [],
      receiptDepositors: [],
      receiptTotalUsdc: 0,
      reportPresent: false,
      poolHoldingCid: '00pool',
      poolAmount: '1.0',
      factoryCid: '00factory',
    }
    const cfg = {
      operator: 'op',
      oracle: 'or',
      mmBuyer: 'mm',
      cashInstrument: 'mUSDC',
      epochLengthMs: 1,
      depositWindowMs: 0,
      tickMs: 1,
      premiumBps: 100,
      allocateWindowMs: 86_400_000,
      settleBufferMs: 3_600_000,
      useRealRegistry: false,
      registryUrl: 'https://registry.test',
      registrar: 'registrar',
    }
    const handlers = makeHandlers({ session, reads, cfg } as unknown as HandlerCtx)
    const snap: EpochSnapshot = {
      windowState: 'Open',
      now: 5_000,
      depositWindowClosesAt: 5_000,
      expiry: 0,
      depositCount: 1,
      collateralLocked: false,
      optionWritten: false,
      premiumPaid: false,
      premiumDistributed: false,
      settled: false,
      epochRecorded: false,
    }
    const r = await runOnce(snap, handlers)
    expect(r.action).toBe('LockCollateral')
    expect(calls).toEqual(['LockCollateral'])
  })
})
