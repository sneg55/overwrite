// The authoritative scheduler loop. Each tick: read on-ledger state, compute the one
// next action, dispatch its handler. Idempotent and missed-tick tolerant because the
// action is recomputed from observed state every tick (design decision 1-3). Errors
// in a tick are logged and swallowed so a transient ledger hiccup does not kill the
// singleton operator loop; the next tick retries.

import { isAppError } from '@/constants/errorIds'
import { delay } from '@/services/async'
import type { LedgerSession } from '@/services/ledger-client/session'
import type { SchedulerConfig } from './config'
import type { EngineControlHandle } from './control'
import { makeHandlers } from './make-handlers'
import { readTick } from './reads'
import { runOnce } from './runner'
import { toSnapshot } from './snapshot'
import { nextAction, type SchedulerAction } from './state-machine'

export type TickObserver = (action: SchedulerAction, dispatched: boolean) => void

export async function runScheduler(
  session: LedgerSession,
  cfg: SchedulerConfig,
  signal: AbortSignal,
  onTick?: TickObserver,
  control?: EngineControlHandle,
): Promise<void> {
  while (!signal.aborted) {
    try {
      const reads = await readTick(session, cfg)
      if (reads !== null) {
        const snapshot = toSnapshot(reads)
        // Reported whether or not we dispatch, so a paused operator can see what the
        // engine WOULD do next. nextAction is pure, so asking costs nothing and
        // changes nothing.
        control?.recordNextAction(nextAction(snapshot))

        // Pausing is checked here, between ticks, and runOnce is awaited below, so a
        // tick either completes or never starts. A pause can never interrupt a
        // transaction in flight, which is what makes manual stepping safe.
        const paused = control?.status().paused === true
        const stepping = control?.consumeStep() === true

        if (!paused || stepping) {
          const handlers = makeHandlers({ session, reads, cfg })
          const result = await runOnce(snapshot, handlers)
          control?.recordTick({
            action: result.action,
            dispatched: result.dispatched,
            at: new Date().toISOString(),
          })
          onTick?.(result.action, result.dispatched)
        }
      }
    } catch (e) {
      const line = isAppError(e) ? e.toLogLine() : e instanceof Error ? e.message : String(e)
      console.error(`[scheduler] tick error: ${line}`)
      // Surfaced rather than only logged: an operator watching the UI could not
      // previously tell a wedged engine from an idle one.
      control?.recordError(line, new Date().toISOString())
    }
    await delay(cfg.tickMs, signal)
  }
}
