import { describe, expect, test } from 'bun:test'
import { type EpochSnapshot, isCommandAction, nextAction } from './state-machine'

const base: EpochSnapshot = {
  windowState: 'Open',
  now: 1_000,
  depositWindowClosesAt: 2_000,
  expiry: 5_000,
  depositCount: 0,
  collateralLocked: false,
  optionWritten: false,
  premiumPaid: false,
  premiumDistributed: false,
  settled: false,
  epochRecorded: false,
}

describe('nextAction', () => {
  test('waits while the deposit window is still open', () => {
    expect(nextAction({ ...base, now: 1_500, depositCount: 3 })).toBe('AwaitDeposits')
  })

  test('waits if the window closed but nobody deposited', () => {
    expect(nextAction({ ...base, now: 2_500, depositCount: 0 })).toBe('AwaitDeposits')
  })

  test('locks once the window closes with deposits present', () => {
    expect(nextAction({ ...base, now: 2_500, depositCount: 3 })).toBe('LockCollateral')
  })

  test('writes the call after collateral is locked', () => {
    expect(nextAction({ ...base, now: 2_500, depositCount: 3, collateralLocked: true })).toBe(
      'WriteCall',
    )
  })

  test('awaits premium after the call is written', () => {
    const s = { ...base, now: 2_500, collateralLocked: true, optionWritten: true }
    expect(nextAction(s)).toBe('AwaitPremium')
  })

  test('distributes premium once paid', () => {
    const s = {
      ...base,
      now: 2_500,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
    }
    expect(nextAction(s)).toBe('DistributePremium')
  })

  test('awaits expiry after distribution, before expiry', () => {
    const s = {
      ...base,
      now: 3_000,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
      premiumDistributed: true,
    }
    expect(nextAction(s)).toBe('AwaitExpiry')
  })

  test('settles at expiry', () => {
    const s = {
      ...base,
      now: 6_000,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
      premiumDistributed: true,
    }
    expect(nextAction(s)).toBe('Settle')
  })

  test('records then rolls', () => {
    const settled = {
      ...base,
      now: 6_000,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
      premiumDistributed: true,
      settled: true,
    }
    expect(nextAction(settled)).toBe('RecordEpoch')
    expect(nextAction({ ...settled, epochRecorded: true })).toBe('Roll')
  })

  test('reopens deposits from a settling window', () => {
    expect(nextAction({ ...base, windowState: 'Settling' })).toBe('OpenDeposits')
  })
})

describe('isCommandAction', () => {
  test('Await* actions are passive', () => {
    expect(isCommandAction('AwaitDeposits')).toBe(false)
    expect(isCommandAction('AwaitPremium')).toBe(false)
    expect(isCommandAction('AwaitExpiry')).toBe(false)
  })
  test('lifecycle steps are commands', () => {
    expect(isCommandAction('LockCollateral')).toBe(true)
    expect(isCommandAction('Settle')).toBe(true)
    expect(isCommandAction('Roll')).toBe(true)
  })
})
