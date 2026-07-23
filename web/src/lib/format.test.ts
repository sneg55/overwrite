import { expect, test } from 'bun:test'
import { formatCbtc, formatUsd } from '@/lib/format'

test('formatUsd keeps whole dollars for values of one dollar and up', () => {
  expect(formatUsd(66000)).toBe('$66,000')
  expect(formatUsd(1)).toBe('$1')
})

test('formatUsd never renders a real sub-dollar payout as zero', () => {
  // A demo premium can legitimately land below a dollar. Rounding it to $0 would
  // show a depositor that they were paid nothing when they were paid something.
  expect(formatUsd(0.0125)).toBe('$0.0125')
  expect(formatUsd(0.5)).toBe('$0.50')
})

test('formatUsd renders an exact zero as zero', () => {
  // Zero is a real answer, not a rounding artifact, so it keeps the plain form.
  expect(formatUsd(0)).toBe('$0')
})

test('formatUsd refuses to invent a number from a bad read', () => {
  expect(formatUsd(Number.NaN)).toBe('Not recorded')
  expect(formatUsd(Number.POSITIVE_INFINITY)).toBe('Not recorded')
})

test('formatCbtc still never rounds away satoshis', () => {
  expect(formatCbtc(1.5)).toBe('1.5 CBTC')
  expect(formatCbtc(0.00000001)).toBe('0.00000001 CBTC')
})
