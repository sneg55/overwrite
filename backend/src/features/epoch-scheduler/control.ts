// Engine control state, kept out of the loop so it is testable without a ledger and
// without a clock. The loop consults it between ticks; the REST layer mutates it.
//
// A step is refused unless the engine is paused. That single rule is what keeps a
// manual step from racing a live tick: while running, the loop is the only thing
// dispatching, and while paused it dispatches only on an explicit, single-use request.

import type { SchedulerAction } from './state-machine'

export interface EngineStatus {
  paused: boolean
  /** What the state machine would do next. Computed, never dispatched. */
  nextAction: SchedulerAction | null
  lastAction: SchedulerAction | null
  lastDispatchedAt: string | null
  lastTickAt: string | null
  lastError: string | null
  tickMs: number
}

export interface TickRecord {
  action: SchedulerAction
  dispatched: boolean
  at: string
}

export interface EngineControlHandle {
  status: () => EngineStatus
  pause: () => void
  resume: () => void
  /** Returns false when refused because the engine is not paused. */
  requestStep: () => boolean
  /** Returns true exactly once per honored request, then resets. */
  consumeStep: () => boolean
  recordTick: (r: TickRecord) => void
  recordNextAction: (a: SchedulerAction) => void
  recordError: (message: string, at: string) => void
}

export function makeEngineControl(tickMs: number): EngineControlHandle {
  let paused = false
  let stepRequested = false
  let nextAction: SchedulerAction | null = null
  let lastAction: SchedulerAction | null = null
  let lastDispatchedAt: string | null = null
  let lastTickAt: string | null = null
  let lastError: string | null = null

  return {
    status: () => ({
      paused,
      nextAction,
      lastAction,
      lastDispatchedAt,
      lastTickAt,
      lastError,
      tickMs,
    }),
    pause: () => {
      paused = true
    },
    resume: () => {
      paused = false
      stepRequested = false
    },
    requestStep: () => {
      if (!paused) return false
      stepRequested = true
      return true
    },
    consumeStep: () => {
      if (!paused || !stepRequested) return false
      stepRequested = false
      return true
    },
    recordTick: (r) => {
      lastTickAt = r.at
      lastAction = r.action
      if (r.dispatched) lastDispatchedAt = r.at
      lastError = null
    },
    recordNextAction: (a) => {
      nextAction = a
    },
    recordError: (message, at) => {
      lastError = message
      lastTickAt = at
    },
  }
}
