import { describe, expect, test } from 'bun:test'
import { decideExercise, demoStrikeUsdPerCbtc, quoteDemoPremiumUsd } from './decide'

describe('decideExercise', () => {
  test('exercises when in the money', () => {
    expect(decideExercise(70_000, 66_000)).toBe('exercise')
  })
  test('walks when out of the money', () => {
    expect(decideExercise(60_000, 66_000)).toBe('walk')
  })
  test('walks exactly on the strike (matches SettleOTM price <= strike)', () => {
    expect(decideExercise(66_000, 66_000)).toBe('walk')
  })
})

describe('quoteDemoPremiumUsd', () => {
  test('flat bps on notional value', () => {
    // 1 CBTC at 60000, 100 bps = 1% = 600
    expect(quoteDemoPremiumUsd(1, 60_000, 100)).toBe(600)
  })
  test('scales with notional', () => {
    expect(quoteDemoPremiumUsd(3, 60_000, 100)).toBe(1_800)
  })
  test('non-positive inputs yield zero', () => {
    expect(quoteDemoPremiumUsd(0, 60_000, 100)).toBe(0)
    expect(quoteDemoPremiumUsd(1, 0, 100)).toBe(0)
    expect(quoteDemoPremiumUsd(1, 60_000, 0)).toBe(0)
  })
})

describe('demoStrikeUsdPerCbtc', () => {
  test('applies the strike pct to spot at open', () => {
    expect(demoStrikeUsdPerCbtc(60_000, 0.1)).toBe(66_000)
  })
})
