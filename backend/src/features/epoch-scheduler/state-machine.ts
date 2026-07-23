// Pure epoch state machine. Given a snapshot of the on-ledger Vault + wall clock,
// it returns the single next action the scheduler should take. Keeping this pure
// (no ledger I/O) makes the lifecycle exhaustively unit-testable, and makes the
// scheduler idempotent: it is keyed off observed on-ledger state, not internal
// timers, so a missed cron tick just recomputes the same action.
//
// Sequence (design doc): OpenDeposits -> deposits land -> LockCollateral ->
// WriteCall -> await PayPremium -> DistributePremium (fan-out) -> expiry ->
// Settle -> RecordEpoch -> Roll.

export type SchedulerAction =
  | 'OpenDeposits'
  | 'AwaitDeposits'
  | 'LockCollateral'
  | 'WriteCall'
  | 'AwaitPremium'
  | 'DistributePremium'
  | 'AwaitExpiry'
  | 'Settle'
  | 'RecordEpoch'
  | 'Roll'

export type WindowState = 'Open' | 'Locked' | 'Settling'

export interface EpochSnapshot {
  /** on-ledger deposit window state */
  windowState: WindowState
  /** wall clock, ms since epoch */
  now: number
  /** when the deposit window should close and collateral lock, ms */
  depositWindowClosesAt: number
  /** option expiry, ms */
  expiry: number
  /** number of VaultPositions this epoch */
  depositCount: number
  collateralLocked: boolean
  optionWritten: boolean
  premiumPaid: boolean
  premiumDistributed: boolean
  settled: boolean
  epochRecorded: boolean
}

/**
 * The next action for the scheduler. Ordered by lifecycle phase; the first
 * unsatisfied step wins. `Await*` actions mean "nothing to do yet, wait".
 */
export function nextAction(s: EpochSnapshot): SchedulerAction {
  if (!s.collateralLocked) {
    if (s.windowState === 'Settling') return 'OpenDeposits'
    if (s.now < s.depositWindowClosesAt) return 'AwaitDeposits'
    if (s.depositCount === 0) return 'AwaitDeposits'
    return 'LockCollateral'
  }
  if (!s.optionWritten) return 'WriteCall'
  if (!s.premiumPaid) return 'AwaitPremium'
  if (!s.premiumDistributed) return 'DistributePremium'
  if (s.now < s.expiry) return 'AwaitExpiry'
  if (!s.settled) return 'Settle'
  if (!s.epochRecorded) return 'RecordEpoch'
  return 'Roll'
}

/** Actions that submit a ledger command (vs. the passive Await* waits). */
export function isCommandAction(a: SchedulerAction): boolean {
  return a !== 'AwaitDeposits' && a !== 'AwaitPremium' && a !== 'AwaitExpiry'
}
