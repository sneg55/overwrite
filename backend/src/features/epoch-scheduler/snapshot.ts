// Pure map from on-ledger reads to the EpochSnapshot the state machine consumes.
// Because SettleOTM/SettleITM archive the CallOption (design decision 2), "settled"
// is inferred from a Locked vault with no live option, no live CBTC allocation, and
// no report yet. A live allocation is what separates "locked, not yet written" from
// "settled, not yet recorded". A leftover epoch (design decision 3) forces every flag
// true so the machine yields Roll. The deposit window is treated as already closed
// (design decision 1): depositWindowClosesAt = now.

import type { TickReads } from './reads'
import type { EpochSnapshot, WindowState } from './state-machine'

export function toSnapshot(r: TickReads): EpochSnapshot {
  if (r.isLeftover) {
    return {
      windowState: 'Locked',
      now: r.now,
      depositWindowClosesAt: r.now,
      expiry: 0,
      depositCount: r.positions.length,
      collateralLocked: true,
      optionWritten: true,
      premiumPaid: true,
      premiumDistributed: true,
      settled: true,
      epochRecorded: true,
    }
  }

  const optionPresent = r.optionCid !== undefined
  const optionActiveOrSettled = r.optionState === 'Active' || r.optionState === 'Settled'
  // Collateral is locked whenever the ledger actually holds it: a live CBTC allocation, or
  // a written option (which could only exist against locked collateral). The window state
  // alone is not enough. The seeded demo reopens the deposit window (Open) while the epoch
  // is still collateralised and its option Active, so keying off windowState === 'Locked'
  // made the scheduler believe nothing was locked and retry LockCollateral every tick with
  // no free operator pool (E_SCHED_001, a permanent error on the operator's page). In the
  // real lifecycle the window is Locked for exactly the collateralised phase, so these
  // extra terms agree with it; they diverge only for the reopened-window snapshot, which is
  // the case to fix. `settled` below still resolves correctly: once the option and
  // allocation are gone, both extra terms are false and this falls back to the window.
  const collateralLocked = r.windowState === 'Locked' || r.allocationPresent || optionPresent
  const settled = collateralLocked && !optionPresent && !r.allocationPresent && !r.reportPresent
  const positionsCount = r.positions.length
  const distributed = positionsCount > 0 && r.receiptDepositors.length >= positionsCount

  return {
    windowState: r.windowState as WindowState,
    now: r.now,
    depositWindowClosesAt: r.now,
    expiry: r.optionExpiryMs ?? 0,
    depositCount: positionsCount,
    collateralLocked,
    optionWritten: optionPresent || settled,
    premiumPaid: (optionPresent && optionActiveOrSettled) || settled,
    premiumDistributed: distributed || settled,
    settled,
    epochRecorded: r.reportPresent,
  }
}
