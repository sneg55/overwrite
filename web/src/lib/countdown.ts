// Pure countdown math, no React and no clock of its own: the caller passes both
// `nowMs` and `expiryMs`. That is what lets the server render a stable first value
// and the client re-derive against the real clock without a hydration mismatch.

export interface Countdown {
  expired: boolean
  totalMs: number
  days: number
  hours: number
  minutes: number
  seconds: number
}

export function remainingMs(nowMs: number, expiryMs: number): number {
  const diff = expiryMs - nowMs
  return diff > 0 ? diff : 0
}

export function countdownFrom(nowMs: number, expiryMs: number): Countdown {
  const totalMs = remainingMs(nowMs, expiryMs)
  const totalSeconds = Math.floor(totalMs / 1000)
  const days = Math.floor(totalSeconds / 86_400)
  const hours = Math.floor((totalSeconds % 86_400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return { expired: totalMs === 0, totalMs, days, hours, minutes, seconds }
}

const pad = (n: number): string => String(n).padStart(2, '0')

export function formatCountdown(c: Countdown): string {
  if (c.expired) return 'Expired'
  if (c.days > 0) return `${c.days}d ${pad(c.hours)}h ${pad(c.minutes)}m`
  return `${pad(c.hours)}:${pad(c.minutes)}:${pad(c.seconds)}`
}
