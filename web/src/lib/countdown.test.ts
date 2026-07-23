import { expect, test } from 'bun:test'
import { countdownFrom, formatCountdown, remainingMs } from '@/lib/countdown'

const S = 1000
const M = 60 * S
const H = 60 * M
const D = 24 * H

test('remainingMs clamps a past expiry to zero', () => {
  expect(remainingMs(100, 50)).toBe(0)
  expect(remainingMs(50, 100)).toBe(50)
})

test('countdownFrom decomposes a duration', () => {
  const c = countdownFrom(0, 2 * D + 3 * H + 4 * M + 5 * S)
  expect(c).toEqual({ expired: false, totalMs: 2 * D + 3 * H + 4 * M + 5 * S, days: 2, hours: 3, minutes: 4, seconds: 5 })
})

test('countdownFrom marks an elapsed window expired', () => {
  const c = countdownFrom(100, 100)
  expect(c.expired).toBe(true)
  expect(c.totalMs).toBe(0)
})

test('formatCountdown shows days when a day or more remains', () => {
  expect(formatCountdown(countdownFrom(0, 2 * D + 3 * H + 4 * M))).toBe('2d 03h 04m')
})

test('formatCountdown shows hh:mm:ss under a day', () => {
  expect(formatCountdown(countdownFrom(0, 3 * H + 4 * M + 5 * S))).toBe('03:04:05')
})

test('formatCountdown says Expired at zero', () => {
  expect(formatCountdown(countdownFrom(100, 100))).toBe('Expired')
})
