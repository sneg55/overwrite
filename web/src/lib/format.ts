// Deterministic formatting. Every formatter pins an explicit locale so the server
// render and the client hydration agree; a bare `toLocaleString()` resolves against
// whatever locale the process (or browser) happens to have, which both mismatches on
// hydration and quietly changes what money looks like.

const LOCALE = 'en-US'

const usd = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

// Sub-dollar amounts need real precision. A demo premium can land below a dollar,
// and whole-dollar rounding would report a payout that happened as one that did not.
const usdSmall = new Intl.NumberFormat(LOCALE, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})

const cbtc = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 0,
  maximumFractionDigits: 8,
})

const expiry = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})

/**
 * USD for display. Whole dollars at a dollar and above, real precision below it,
 * and an explicit refusal on a value we never actually read. Never `$NaN`, and
 * never a zero that is really a rounding artifact.
 */
export const formatUsd = (value: number): string => {
  if (!Number.isFinite(value)) return 'Not recorded'
  if (value !== 0 && Math.abs(value) < 1) return usdSmall.format(value)
  return usd.format(value)
}

/** CBTC amount with a unit, e.g. `3 CBTC`. Never rounds away satoshis. */
export const formatCbtc = (value: number): string => `${cbtc.format(value)} CBTC`

/** `Jul 15, 2026, 2:07 PM UTC`. Always UTC: an epoch expiry is a ledger fact. */
export const formatExpiry = (iso: string): string => `${expiry.format(new Date(iso))} UTC`

/** `#1` */
export const formatEpoch = (n: number): string => `#${n}`
