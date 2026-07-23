// Bind the seven command handlers to one tick's context, producing the
// SchedulerHandlers the runner dispatches. Await* actions have no handler (they are
// passive waits filtered out by isCommandAction in the runner).

import { distributePremium, type HandlerCtx, openDeposits, writeCall } from './handlers'
import { lockCollateral } from './handlers-lock'
import { recordEpoch, roll, settle } from './handlers-settle'
import type { SchedulerHandlers } from './runner'

export function makeHandlers(ctx: HandlerCtx): SchedulerHandlers {
  return {
    OpenDeposits: () => openDeposits(ctx),
    LockCollateral: () => lockCollateral(ctx),
    WriteCall: () => writeCall(ctx),
    DistributePremium: () => distributePremium(ctx),
    Settle: () => settle(ctx),
    RecordEpoch: () => recordEpoch(ctx),
    Roll: () => roll(ctx),
  }
}
