// Two handles over one directory stand in for the two processes: `server` is the one
// the REST layer holds and `engine` is the one the loop holds. They share nothing but
// the files, which is exactly the constraint the real deployment imposes.

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { INTENT_FILE, makeFileEngineControl, STATUS_FILE } from './control-file'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'overwrite-control-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const twoProcesses = () => ({
  server: makeFileEngineControl(dir, 5000),
  engine: makeFileEngineControl(dir, 5000),
})

test('a directory with no files reports an engine that has not ticked, and does not throw', () => {
  const h = makeFileEngineControl(dir, 5000)
  const s = h.status()
  expect(s.paused).toBe(false)
  expect(s.nextAction).toBeNull()
  expect(s.lastAction).toBeNull()
  expect(s.lastDispatchedAt).toBeNull()
  expect(s.lastTickAt).toBeNull()
  expect(s.lastError).toBeNull()
  expect(s.tickMs).toBe(5000)
})

test('a pause written by one process is seen by the other', () => {
  const { server, engine } = twoProcesses()
  expect(engine.status().paused).toBe(false)
  server.pause()
  expect(engine.status().paused).toBe(true)
  server.resume()
  expect(engine.status().paused).toBe(false)
})

test('a step crosses the process boundary exactly once', () => {
  const { server, engine } = twoProcesses()
  server.pause()
  expect(server.requestStep()).toBe(true)
  // The tick that runs after the click honours it.
  expect(engine.consumeStep()).toBe(true)
  // Every later tick must not run a second action off the one click.
  expect(engine.consumeStep()).toBe(false)
  expect(engine.consumeStep()).toBe(false)
})

test('repeated clicks between two ticks collapse into one step', () => {
  const { server, engine } = twoProcesses()
  server.pause()
  server.requestStep()
  server.requestStep()
  server.requestStep()
  // At most one request can be pending, matching the in-memory handle's single boolean.
  // An impatient triple-click on a vault engine should advance the epoch once, not
  // three times, and a queue would make the button's effect depend on tick timing.
  expect(engine.consumeStep()).toBe(true)
  expect(engine.consumeStep()).toBe(false)
})

test('a step taken now does not stop the operator asking for another', () => {
  const { server, engine } = twoProcesses()
  server.pause()
  server.requestStep()
  expect(engine.consumeStep()).toBe(true)
  server.requestStep()
  expect(engine.consumeStep()).toBe(true)
  expect(engine.consumeStep()).toBe(false)
})

test('a step is refused while the engine is running', () => {
  const { server, engine } = twoProcesses()
  expect(server.requestStep()).toBe(false)
  expect(engine.consumeStep()).toBe(false)
})

test('resuming spends a step that no tick got to first', () => {
  const { server, engine } = twoProcesses()
  server.pause()
  server.requestStep()
  server.resume()
  // The loop is dispatching on its own again, so the pending request is spent here.
  expect(engine.consumeStep()).toBe(false)
  server.pause()
  // It must not fire late, on the next pause the operator happens to make.
  expect(engine.consumeStep()).toBe(false)
})

test('the engine writes status that the server reads back', () => {
  const { server, engine } = twoProcesses()
  engine.recordNextAction('WriteCall')
  engine.recordTick({ action: 'LockCollateral', dispatched: true, at: '2026-07-20T10:00:00.000Z' })
  const s = server.status()
  expect(s.nextAction).toBe('WriteCall')
  expect(s.lastAction).toBe('LockCollateral')
  expect(s.lastDispatchedAt).toBe('2026-07-20T10:00:00.000Z')
  expect(s.lastTickAt).toBe('2026-07-20T10:00:00.000Z')
  expect(s.lastError).toBeNull()
})

test('a tick error reaches the other process, and the next good tick clears it', () => {
  const { server, engine } = twoProcesses()
  engine.recordError('ledger unreachable', '2026-07-20T10:00:05.000Z')
  expect(server.status().lastError).toBe('ledger unreachable')
  engine.recordTick({ action: 'AwaitExpiry', dispatched: false, at: '2026-07-20T10:00:07.000Z' })
  expect(server.status().lastError).toBeNull()
})

test('an undispatched tick does not move the last dispatch time', () => {
  const { server, engine } = twoProcesses()
  engine.recordTick({ action: 'LockCollateral', dispatched: true, at: '2026-07-20T10:00:00.000Z' })
  engine.recordTick({ action: 'AwaitExpiry', dispatched: false, at: '2026-07-20T10:00:02.000Z' })
  const s = server.status()
  expect(s.lastDispatchedAt).toBe('2026-07-20T10:00:00.000Z')
  expect(s.lastTickAt).toBe('2026-07-20T10:00:02.000Z')
})

test('a malformed status file is surfaced as an error rather than crashing the reader', () => {
  writeFileSync(join(dir, STATUS_FILE), '{ this is not json', 'utf8')
  const h = makeFileEngineControl(dir, 5000)
  const s = h.status()
  expect(s.lastError).not.toBeNull()
  expect(s.lastError).toContain('E_SCHED_007')
  expect(s.nextAction).toBeNull()
})

test('a malformed intent file leaves the engine running rather than wedging it', () => {
  writeFileSync(join(dir, INTENT_FILE), 'null', 'utf8')
  const h = makeFileEngineControl(dir, 5000)
  // An unparseable intent must not read as paused: a corrupt file would otherwise
  // silently halt the vault engine with no operator having asked for it.
  expect(h.status().paused).toBe(false)
  expect(h.status().lastError).toContain('E_SCHED_007')
  expect(h.consumeStep()).toBe(false)
})

test('a control file carrying wrong types falls back instead of propagating them', () => {
  writeFileSync(join(dir, INTENT_FILE), JSON.stringify({ paused: 'yes', stepSeq: 'three' }), 'utf8')
  const h = makeFileEngineControl(dir, 5000)
  expect(h.status().paused).toBe(false)
  expect(h.consumeStep()).toBe(false)
})

test('a directory that does not exist yet is created by the first write', () => {
  const nested = join(dir, 'does', 'not', 'exist')
  const h = makeFileEngineControl(nested, 5000)
  expect(h.status().paused).toBe(false)
  h.pause()
  expect(makeFileEngineControl(nested, 5000).status().paused).toBe(true)
})
