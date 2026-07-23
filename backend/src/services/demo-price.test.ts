import { describe, expect, test } from 'bun:test'
import { type DemoPriceSchedule, demoPriceAt } from './demo-price'

describe('demoPriceAt', () => {
  const stepped: DemoPriceSchedule = { base: '60000.0', late: '80000.0', switchMs: 8_000 }

  test('reports the base price before the switch', () => {
    expect(demoPriceAt(stepped, 0)).toBe('60000.0')
    expect(demoPriceAt(stepped, 7_999)).toBe('60000.0')
  })

  test('reports the late price at and after the switch', () => {
    expect(demoPriceAt(stepped, 8_000)).toBe('80000.0')
    expect(demoPriceAt(stepped, 50_000)).toBe('80000.0')
  })

  test('is constant when only a base price is configured', () => {
    const flat: DemoPriceSchedule = { base: '70000.0' }
    expect(demoPriceAt(flat, 0)).toBe('70000.0')
    expect(demoPriceAt(flat, 999_999)).toBe('70000.0')
  })

  test('stays on base when the step is half-configured (late without switchMs)', () => {
    expect(demoPriceAt({ base: '60000.0', late: '80000.0' }, 999_999)).toBe('60000.0')
  })

  test('stays on base when the step is half-configured (switchMs without late)', () => {
    expect(demoPriceAt({ base: '60000.0', switchMs: 1 }, 999_999)).toBe('60000.0')
  })
})
