import { describe, expect, test } from 'bun:test'
import type { TickReads } from './reads'
import { toSnapshot } from './snapshot'
import { nextAction } from './state-machine'

const base: TickReads = {
  now: 5_000,
  vaultCid: '00v',
  vaultEpoch: 1,
  windowState: 'Open',
  workingEpoch: 1,
  isLeftover: false,
  positions: [
    { cid: '00p', depositor: 'alice', principalCbtc: '3.0', epochNumber: 1, withdrawQueued: false },
  ],
  allocationPresent: false,
  receiptCids: [],
  receiptDepositors: [],
  receiptTotalUsdc: 0,
  reportPresent: false,
}

describe('toSnapshot -> nextAction', () => {
  test('open window with deposits -> LockCollateral', () => {
    expect(nextAction(toSnapshot(base))).toBe('LockCollateral')
  })

  test('locked with a live allocation, no option -> WriteCall', () => {
    const r = { ...base, windowState: 'Locked', allocationPresent: true }
    expect(nextAction(toSnapshot(r))).toBe('WriteCall')
  })

  test('option Active, receipts complete, before expiry -> AwaitExpiry', () => {
    const r: TickReads = {
      ...base,
      windowState: 'Locked',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionExpiryMs: 9_000,
      receiptDepositors: ['alice'],
    }
    expect(nextAction(toSnapshot(r))).toBe('AwaitExpiry')
  })

  test('option Active, receipts complete, past expiry -> Settle', () => {
    const r: TickReads = {
      ...base,
      now: 10_000,
      windowState: 'Locked',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionExpiryMs: 9_000,
      receiptDepositors: ['alice'],
    }
    expect(nextAction(toSnapshot(r))).toBe('Settle')
  })

  test('reopened window while collateral locked and option Active -> AwaitExpiry (not LockCollateral)', () => {
    // The seeded demo reopens the deposit window (Open) while epoch 1's allocation and
    // option are still live. Collateral is locked in fact, so the scheduler must not try to
    // LockCollateral again (it would fail with no free operator pool, E_SCHED_001); it
    // waits for expiry instead.
    const r: TickReads = {
      ...base,
      windowState: 'Open',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionExpiryMs: 9_000,
      receiptDepositors: ['alice'],
    }
    expect(nextAction(toSnapshot(r))).toBe('AwaitExpiry')
  })

  test('post-settle (option gone, allocation gone, no report) -> RecordEpoch', () => {
    const r = { ...base, windowState: 'Locked', allocationPresent: false }
    expect(nextAction(toSnapshot(r))).toBe('RecordEpoch')
  })

  test('leftover epoch -> Roll', () => {
    const r = { ...base, isLeftover: true }
    expect(nextAction(toSnapshot(r))).toBe('Roll')
  })
})
