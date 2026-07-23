// Daml Decimal helpers. The JSON Ledger API serializes Decimal as a string, and
// choice guards compare amounts by numeric value, so an amount passed into a choice
// must equal the on-ledger holding amount. We format at a fixed scale (4 dp is ample
// for demo USD/CBTC) and split premium via integer scaling so per-position chunks
// sum EXACTLY to the received premium (the last chunk is the remainder).

import { AppError, ErrorIds } from '../constants/errorIds'

const SCALE = 10_000

export function toDecimal(n: number, places = 4): string {
  let s = n.toFixed(places)
  if (s.includes('.')) {
    s = s.replace(/0+$/, '')
    if (s.endsWith('.')) s += '0'
  } else {
    s += '.0'
  }
  return s
}

export function parseDecimal(s: string): number {
  return Number(s)
}

export function splitPremium(total: string, principals: string[]): string[] {
  const totalUnits = Math.round(parseDecimal(total) * SCALE)
  const weights = principals.map((p) => Math.round(parseDecimal(p) * SCALE))
  const w = weights.reduce((a, b) => a + b, 0)
  // A zero total genuinely distributes to all-zero chunks: that sum is exact.
  if (totalUnits === 0) return principals.map(() => toDecimal(0))
  // A nonzero total has no principled split across zero (or no) weighted
  // principals. Returning all-zero chunks here would silently break the
  // exact-sum invariant this function promises its callers, so fail loud
  // instead of guessing.
  if (principals.length === 0 || w <= 0) {
    throw new AppError(
      ErrorIds.DEC_ZERO_WEIGHT_SPLIT,
      `${ErrorIds.DEC_ZERO_WEIGHT_SPLIT}: cannot split nonzero premium across zero-weight principals`,
      { total, principals },
    )
  }
  // Every position gets exactly one PremiumReceipt, and PayoutPremium pays a real
  // holding (Holding.ensure amount > 0). A pro-rata floor can round a small principal
  // down to a zero chunk; distributePremium would then Split a holding by 0, which
  // aborts. Reserve one unit per position, then distribute the remainder pro-rata (the
  // last position absorbs rounding), so every chunk is > 0 and the sum stays exact.
  const count = weights.length
  if (totalUnits < count) {
    throw new AppError(
      ErrorIds.DEC_PREMIUM_TOO_SMALL,
      `${ErrorIds.DEC_PREMIUM_TOO_SMALL}: premium ${total} is too small to give ${count} positive chunks`,
      { total, principals },
    )
  }
  const rest = totalUnits - count
  const out: number[] = []
  let assigned = 0
  for (let i = 0; i < count; i++) {
    if (i === count - 1) {
      out.push(1 + rest - assigned)
      break
    }
    const share = Math.floor((rest * (weights[i] ?? 0)) / w)
    out.push(1 + share)
    assigned += share
  }
  return out.map((u) => toDecimal(u / SCALE))
}
