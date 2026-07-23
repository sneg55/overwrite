import { expect, test } from 'bun:test'
import { compareDecimal, parseDecimalUnits } from '@/lib/decimal'

test('compares plain decimals exactly', () => {
  expect(compareDecimal('0.001', '0.01')).toBe(-1)
  expect(compareDecimal('0.01', '0.001')).toBe(1)
  expect(compareDecimal('1.5', '1.50000')).toBe(0)
  expect(compareDecimal('2', '2.0000000000')).toBe(0)
})

// The case that motivated this helper: a dust amount vs the vault minimum. Done in
// floats, 0.00000001 is 9.99999993922529e-9 in float32 and inexact in float64 too.
test('a dust amount is below a 0.001 minimum', () => {
  expect(compareDecimal('0.00000001', '0.001')).toBe(-1)
})

test('an amount exactly at the minimum is not below it', () => {
  expect(compareDecimal('0.001', '0.001')).toBe(0)
})

test('handles a leading or omitted zero', () => {
  expect(compareDecimal('.5', '0.5')).toBe(0)
  expect(compareDecimal('0.5', '.5')).toBe(0)
})

test('handles negatives', () => {
  expect(compareDecimal('-5', '0')).toBe(-1)
  expect(compareDecimal('-0.001', '-0.01')).toBe(1)
})

test('rejects non-decimal input rather than guessing an order', () => {
  expect(compareDecimal('abc', '1')).toBeNull()
  expect(compareDecimal('', '1')).toBeNull()
  expect(compareDecimal('1', '')).toBeNull()
  // Exponent notation is not what an amount field produces and Daml will not parse it.
  expect(compareDecimal('1e-8', '0.001')).toBeNull()
})

test('rejects more precision than a Daml Decimal carries', () => {
  expect(parseDecimalUnits('0.00000000001')).toBeNull()
  expect(parseDecimalUnits('0.0000000001')).not.toBeNull()
})

test('parses to a scaled bigint at 10 decimal places', () => {
  expect(parseDecimalUnits('1')).toBe(10_000_000_000n)
  expect(parseDecimalUnits('0.001')).toBe(10_000_000n)
})
