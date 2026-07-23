// The engine control channel that survives a process boundary.
//
// `makeEngineControl` in ./control keeps its state in a closure, which is correct for
// the loop's own tests and useless in production: `sandbox.sh serve` runs the REST
// server and `sandbox.sh engine` forks the scheduler, so the operator's Pause button
// and the loop that must honour it live in different OS processes. This implements the
// same `EngineControlHandle` over two small JSON files, so neither the loop nor the
// server needs to know which one it got.
//
// Two files, one writer each. The server owns intent, the scheduler owns status. A
// single file written by both would be a read-modify-write race between processes with
// no lock to arbitrate it: whichever wrote last would silently erase the other's field.
// Splitting by writer removes the race rather than narrowing it.
//
// Steps cross as a sequence number, not a flag. The server increments `stepSeq`; the
// scheduler records the highest seq it has acted on and honours a request only when
// `stepSeq` is ahead of that record. A boolean would be lost or double-consumed
// depending on where the tick fell, whereas a monotonic counter makes the handoff
// exactly-once without either side coordinating with the other.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { AppError, ErrorIds } from '@/constants/errorIds'
import type { EngineControlHandle, EngineStatus, TickRecord } from './control'
import type { SchedulerAction } from './state-machine'

export const INTENT_FILE = 'engine-intent.json'
export const STATUS_FILE = 'engine-status.json'

/** Written only by the REST server. What the operator has asked the engine to do. */
interface Intent {
  paused: boolean
  /** Monotonic. Incremented once per accepted step request, never reset. */
  stepSeq: number
}

/** Written only by the scheduler. What the engine has actually observed and done. */
interface Status {
  nextAction: SchedulerAction | null
  lastAction: SchedulerAction | null
  lastDispatchedAt: string | null
  lastTickAt: string | null
  lastError: string | null
  /** The highest `stepSeq` this loop has already settled, honoured or discarded. */
  consumedStepSeq: number
}

const FRESH_INTENT: Intent = { paused: false, stepSeq: 0 }

const FRESH_STATUS: Status = {
  nextAction: null,
  lastAction: null,
  lastDispatchedAt: null,
  lastTickAt: null,
  lastError: null,
  consumedStepSeq: 0,
}

type ReadResult<T> = { value: T; malformed: string | null }

// A missing file is not a failure: it means the process that owns it has not written
// yet, which for the status file is simply an engine that has not ticked. A malformed
// file is a failure, but not one worth crashing a vault engine over, so it is carried
// back as a message for `status()` to surface. Reads run every tick on the scheduler
// side, so this stays synchronous and allocation-light rather than paying for a promise
// per field access.
function readJson<T>(
  path: string,
  fallback: T,
  shape: (v: Record<string, unknown>) => T,
): ReadResult<T> {
  if (!existsSync(path)) return { value: fallback, malformed: null }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {
        value: fallback,
        malformed: `${ErrorIds.SCHED_CONTROL_UNREADABLE} ${path}: not a JSON object`,
      }
    }
    return { value: shape(parsed as Record<string, unknown>), malformed: null }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    return { value: fallback, malformed: `${ErrorIds.SCHED_CONTROL_UNREADABLE} ${path}: ${detail}` }
  }
}

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const int = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.trunc(v) : 0
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const action = (v: unknown): SchedulerAction | null =>
  typeof v === 'string' ? (v as SchedulerAction) : null

function toIntent(v: Record<string, unknown>): Intent {
  return { paused: bool(v.paused, false), stepSeq: int(v.stepSeq) }
}

function toStatus(v: Record<string, unknown>): Status {
  return {
    nextAction: action(v.nextAction),
    lastAction: action(v.lastAction),
    lastDispatchedAt: str(v.lastDispatchedAt),
    lastTickAt: str(v.lastTickAt),
    lastError: str(v.lastError),
    consumedStepSeq: int(v.consumedStepSeq),
  }
}

// Write to a sibling temp file and rename over the target. Rename is atomic on POSIX,
// so the other process never reads a half-written file even though reads happen on
// every tick with no lock between them. The temp path is derived from the target, which
// is safe precisely because each file has exactly one writer.
function writeAtomic(path: string, data: unknown): void {
  const tmp = `${path}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    renameSync(tmp, path)
  } catch (e) {
    throw new AppError(ErrorIds.FS_WRITE_FAIL, 'could not write the engine control file', {
      path,
      cause: e instanceof Error ? e.message : String(e),
    })
  }
}

export function makeFileEngineControl(dir: string, tickMs: number): EngineControlHandle {
  const intentPath = join(dir, INTENT_FILE)
  const statusPath = join(dir, STATUS_FILE)

  const readIntent = (): ReadResult<Intent> => readJson(intentPath, FRESH_INTENT, toIntent)
  const readStatus = (): ReadResult<Status> => readJson(statusPath, FRESH_STATUS, toStatus)

  const putIntent = (next: Intent): void => {
    writeAtomic(intentPath, next)
  }
  const putStatus = (next: Status): void => {
    writeAtomic(statusPath, next)
  }

  return {
    // Merges both files rather than reporting the scheduler's snapshot alone: `paused`
    // is the server's own field, so a pause shows up in the UI on the next render
    // instead of waiting for a tick to echo it back.
    status: (): EngineStatus => {
      const intent = readIntent()
      const status = readStatus()
      const malformed = intent.malformed ?? status.malformed
      return {
        paused: intent.value.paused,
        nextAction: status.value.nextAction,
        lastAction: status.value.lastAction,
        lastDispatchedAt: status.value.lastDispatchedAt,
        lastTickAt: status.value.lastTickAt,
        // A control file we cannot parse is itself an engine fault, and the operator's
        // panel is the only place it would ever be noticed.
        lastError: malformed ?? status.value.lastError,
        tickMs,
      }
    },

    pause: () => {
      putIntent({ ...readIntent().value, paused: true })
    },

    resume: () => {
      putIntent({ ...readIntent().value, paused: false })
    },

    requestStep: () => {
      const intent = readIntent().value
      if (!intent.paused) return false
      putIntent({ paused: true, stepSeq: intent.stepSeq + 1 })
      return true
    },

    // Called by the loop, and the only place the two files are compared. One read of
    // intent decides both questions, so a pause landing mid-check cannot produce a
    // decision drawn from two different versions of the operator's wishes.
    consumeStep: () => {
      const intent = readIntent().value
      const status = readStatus().value
      if (intent.stepSeq <= status.consumedStepSeq) return false
      if (!intent.paused) {
        // The operator asked for a step and then resumed before this tick ran. The loop
        // is dispatching on its own again, so the request is spent rather than left to
        // fire the next time somebody pauses. This mirrors the in-memory handle, whose
        // `resume` clears a pending request outright.
        putStatus({ ...status, consumedStepSeq: intent.stepSeq })
        return false
      }
      putStatus({ ...status, consumedStepSeq: intent.stepSeq })
      return true
    },

    recordTick: (r: TickRecord) => {
      const status = readStatus().value
      putStatus({
        ...status,
        lastTickAt: r.at,
        lastAction: r.action,
        lastDispatchedAt: r.dispatched ? r.at : status.lastDispatchedAt,
        lastError: null,
      })
    },

    recordNextAction: (a: SchedulerAction) => {
      putStatus({ ...readStatus().value, nextAction: a })
    },

    recordError: (message: string, at: string) => {
      putStatus({ ...readStatus().value, lastError: message, lastTickAt: at })
    },
  }
}
