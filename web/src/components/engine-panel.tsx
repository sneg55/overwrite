// The operator's control room. The scheduler drives every transition on a tick, so this
// shows what it is doing and lets the operator take the wheel. Step is offered only
// while paused: the backend refuses it otherwise, and a button that exists but always
// fails is worse than no button.
//
// Every field distinguishes "nothing yet" from a value. The scheduler runs as a separate
// process, so an operator can genuinely be looking at this panel with no engine behind
// it, and a row of blanks would read as zeroes or as a broken page rather than as the
// engine never having started.

import { Badge } from '@/components/badge'
import { Stat } from '@/components/card'
import { EngineButton } from '@/components/engine-button'
import { pauseEngine, resumeEngine, stepEngine } from '@/lib/engine-actions'

export interface EngineStatusView {
  paused: boolean
  nextAction: string | null
  lastAction: string | null
  lastDispatchedAt: string | null
  lastTickAt: string | null
  lastError: string | null
  tickMs: number
}

const NOT_STARTED = 'Not started yet'

function stamp(iso: string | null): React.ReactNode {
  if (iso === null) return NOT_STARTED
  return <time dateTime={iso}>{iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}</time>
}

export function EnginePanel({
  status,
  actionError = null,
}: {
  status: EngineStatusView
  /** A control click that never landed. Distinct from the engine's own tick error. */
  actionError?: string | null
}) {
  return (
    <div className="engine-panel">
      <Stat
        label="State"
        value={
          status.paused ? (
            <>
              Paused <Badge tone="warn">operator held</Badge>
            </>
          ) : (
            'Running'
          )
        }
      />
      {/* Computed by the state machine and deliberately not dispatched, which is what
          makes a paused engine still worth looking at. */}
      <Stat label="Next action" value={status.nextAction ?? NOT_STARTED} />
      <Stat label="Last action" value={status.lastAction ?? NOT_STARTED} />
      <Stat label="Last tick" value={stamp(status.lastTickAt)} />
      <Stat label="Last dispatch" value={stamp(status.lastDispatchedAt)} />
      <Stat label="Tick interval" value={`${status.tickMs} ms`} />

      {actionError !== null && (
        <p className="error-body" role="alert">
          That control did not reach the engine: {actionError}. Nothing changed.
        </p>
      )}

      {status.lastError !== null && (
        <p className="error-body" role="alert">
          Last tick failed: {status.lastError}
        </p>
      )}

      <div className="action-row">
        {status.paused ? (
          <>
            <form action={resumeEngine}>
              <EngineButton variant="secondary" pendingLabel="Resuming...">
                Resume
              </EngineButton>
            </form>
            <form action={stepEngine}>
              <EngineButton variant="primary" pendingLabel="Stepping...">
                Step
              </EngineButton>
            </form>
          </>
        ) : (
          <form action={pauseEngine}>
            <EngineButton variant="secondary" pendingLabel="Pausing...">
              Pause
            </EngineButton>
          </form>
        )}
      </div>
    </div>
  )
}
