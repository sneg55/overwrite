// The authoritative scheduler runner. It is the thin, testable orchestration layer
// around the pure state machine: read a snapshot of on-ledger state, compute the
// single next action, and dispatch the matching ledger command. Handlers are
// injected (they wrap the ledger gateway), so this loop is unit-testable without a
// ledger, and it is idempotent because the action is recomputed from observed
// state on every tick (a missed tick just recomputes the same action).

import {
  type EpochSnapshot,
  isCommandAction,
  nextAction,
  type SchedulerAction,
} from './state-machine'

// One handler per command action. `Await*` actions are passive (no handler).
export interface SchedulerHandlers {
  OpenDeposits: () => Promise<void>
  LockCollateral: () => Promise<void>
  WriteCall: () => Promise<void>
  DistributePremium: () => Promise<void>
  Settle: () => Promise<void>
  RecordEpoch: () => Promise<void>
  Roll: () => Promise<void>
}

export interface RunResult {
  action: SchedulerAction
  dispatched: boolean
}

// Run a single scheduler tick against a snapshot.
export async function runOnce(
  snapshot: EpochSnapshot,
  handlers: SchedulerHandlers,
): Promise<RunResult> {
  const action = nextAction(snapshot)
  if (!isCommandAction(action)) {
    return { action, dispatched: false }
  }
  switch (action) {
    case 'OpenDeposits':
      await handlers.OpenDeposits()
      break
    case 'LockCollateral':
      await handlers.LockCollateral()
      break
    case 'WriteCall':
      await handlers.WriteCall()
      break
    case 'DistributePremium':
      await handlers.DistributePremium()
      break
    case 'Settle':
      await handlers.Settle()
      break
    case 'RecordEpoch':
      await handlers.RecordEpoch()
      break
    case 'Roll':
      await handlers.Roll()
      break
    // Await* actions are filtered out by isCommandAction above.
    case 'AwaitDeposits':
    case 'AwaitPremium':
    case 'AwaitExpiry':
      return { action, dispatched: false }
  }
  return { action, dispatched: true }
}
