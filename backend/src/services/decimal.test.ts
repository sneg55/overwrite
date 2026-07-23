import { describe, expect, test } from 'bun:test'
import { parseDecimal, splitPremium, toDecimal } from './decimal'

describe('toDecimal', () => {
  test('always emits a Daml-safe decimal string', () => {
    expect(toDecimal(100)).toBe('100.0')
    expect(toDecimal(66000)).toBe('66000.0')
    expect(toDecimal(1800.5)).toBe('1800.5')
    expect(toDecimal(0)).toBe('0.0')
  })
})

describe('parseDecimal', () => {
  test('round-trips', () => {
    expect(parseDecimal('100.0')).toBe(100)
    expect(parseDecimal(toDecimal(3))).toBe(3)
  })
})

describe('splitPremium', () => {
  test('equal principals split evenly and sum exactly', () => {
    const parts = splitPremium('300.0', ['1.0', '1.0', '1.0'])
    expect(parts).toEqual(['100.0', '100.0', '100.0'])
    const sum = parts.reduce((a, p) => a + parseDecimal(p), 0)
    expect(sum).toBe(300)
  })

  test('uneven principals: last chunk carries the remainder so the sum is exact', () => {
    const parts = splitPremium('100.0', ['1.0', '1.0', '1.0'])
    const sum = parts.reduce((a, p) => a + parseDecimal(p), 0)
    expect(sum).toBeCloseTo(100, 6)
    expect(parts).toHaveLength(3)
  })

  test('unequal principals split proportionally and still sum exactly', () => {
    const parts = splitPremium('100.0', ['1.0', '2.0', '7.0'])
    const sum = parts.reduce((a, p) => a + parseDecimal(p), 0)
    expect(sum).toBe(100)
    const [a = 0, b = 0, c = 0] = parts.map(parseDecimal)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })

  test('a tiny unequal principal still gets a positive chunk (no zero to Split on)', () => {
    // 0.0001 would floor to a 0 share; distributePremium would then Split a holding by
    // 0, which aborts. Every depositor gets one receipt, so every chunk must be > 0.
    const parts = splitPremium('1.0', ['100.0', '0.0001', '0.0001'])
    for (const p of parts) expect(parseDecimal(p)).toBeGreaterThan(0)
    const sum = parts.reduce((a, p) => a + parseDecimal(p), 0)
    expect(sum).toBeCloseTo(1, 6)
  })

  test('a premium too small to give every depositor a positive chunk throws', () => {
    // 0.0001 total is one unit; it cannot be split into three positive chunks.
    expect(() => splitPremium('0.0001', ['1.0', '1.0', '1.0'])).toThrow('E_DEC_002')
  })

  test('nonzero total across zero-weight principals throws rather than lying about the sum', () => {
    expect(() => splitPremium('100.0', ['0.0', '0.0'])).toThrow('E_DEC_001')
  })

  test('zero total returns exact all-zero chunks without throwing', () => {
    const parts = splitPremium('0.0', ['1.0', '1.0'])
    expect(parts).toEqual(['0.0', '0.0'])
  })
})
