import { expect, test } from 'bun:test'
import { makeEngineControl } from './control'

test('a fresh control is running and has dispatched nothing', () => {
  const h = makeEngineControl(5000)
  const s = h.status()
  expect(s.paused).toBe(false)
  expect(s.lastAction).toBeNull()
  expect(s.tickMs).toBe(5000)
})

test('pause and resume flip the flag', () => {
  const h = makeEngineControl(5000)
  h.pause()
  expect(h.status().paused).toBe(true)
  h.resume()
  expect(h.status().paused).toBe(false)
})

test('a step is only honored while paused, and only once', () => {
  const h = makeEngineControl(5000)
  // Refusing a step while running is what stops a button racing a live tick.
  expect(h.requestStep()).toBe(false)
  h.pause()
  expect(h.requestStep()).toBe(true)
  expect(h.consumeStep()).toBe(true)
  // Consumed. A second tick must not run a second action off one click.
  expect(h.consumeStep()).toBe(false)
})

test('a running engine consumes no step', () => {
  const h = makeEngineControl(5000)
  expect(h.consumeStep()).toBe(false)
})

test('recording a tick surfaces what ran and what failed', () => {
  const h = makeEngineControl(5000)
  h.recordTick({ action: 'WriteCall', dispatched: true, at: '2026-07-20T10:00:00.000Z' })
  const s = h.status()
  expect(s.lastAction).toBe('WriteCall')
  expect(s.lastDispatchedAt).toBe('2026-07-20T10:00:00.000Z')
  expect(s.lastError).toBeNull()

  h.recordError('ledger unreachable', '2026-07-20T10:00:05.000Z')
  expect(h.status().lastError).toBe('ledger unreachable')
})

test('the next action is reported without being dispatched', () => {
  const h = makeEngineControl(5000)
  h.recordNextAction('Settle')
  expect(h.status().nextAction).toBe('Settle')
})
