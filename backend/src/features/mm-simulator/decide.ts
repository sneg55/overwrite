// Market-maker simulator decision logic (pure). The bot acts as `mm-buyer`: it
// quotes a premium at write time and exercises RATIONALLY at expiry (buys when
// in-the-money, walks when out). Rational exercise is what keeps the lifecycle
// honest: no wash-trading smell, a real counterparty making the economically
// correct choice.
//
// The MM is SIMULATED and labeled everywhere (UI, README, video). Premium is a
// DEMO PARAMETER, not a market quote: the formula below is a transparent stand-in,
// never presented as real option pricing, and there are no APY claims anywhere.

export type ExerciseDecision = 'exercise' | 'walk'

/**
 * At expiry the buyer exercises iff the option is in the money (spot > strike).
 * Exactly on the strike is out-of-the-money (walk), matching CallOption.SettleOTM
 * (`price <= strike`).
 */
export function decideExercise(spotUsdPerCbtc: number, strikeUsdPerCbtc: number): ExerciseDecision {
  return spotUsdPerCbtc > strikeUsdPerCbtc ? 'exercise' : 'walk'
}

/**
 * Demo premium quote. A flat basis-point charge on notional value at open. This is
 * a labeled placeholder, NOT a priced quote (no vol surface, no market data). Kept
 * simple and deterministic so demo epochs are reproducible.
 */
export function quoteDemoPremiumUsd(
  notionalCbtc: number,
  spotUsdPerCbtc: number,
  demoPremiumBps: number,
): number {
  if (notionalCbtc <= 0 || spotUsdPerCbtc <= 0 || demoPremiumBps <= 0) return 0
  return notionalCbtc * spotUsdPerCbtc * (demoPremiumBps / 10_000)
}

/** The strike the vault will write, per the demo strike rule (spot-at-open + pct). */
export function demoStrikeUsdPerCbtc(spotAtOpenUsd: number, strikePct: number): number {
  return spotAtOpenUsd * (1 + strikePct)
}
