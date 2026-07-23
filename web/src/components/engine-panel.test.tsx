import { expect, test } from 'bun:test'
import { EnginePanel } from '@/components/engine-panel'
import { renderMarkup } from '@/test/render'

const RUNNING = {
  paused: false,
  nextAction: 'WriteCall' as const,
  lastAction: 'LockCollateral' as const,
  lastDispatchedAt: '2026-07-20T10:00:00.000Z',
  lastTickAt: '2026-07-20T10:00:05.000Z',
  lastError: null,
  tickMs: 5000,
}

test('a running engine says what it will do next and offers no step', () => {
  const html = renderMarkup(<EnginePanel status={RUNNING} />)
  expect(html).toContain('WriteCall')
  expect(html).toContain('Pause')
  expect(html).not.toContain('Step')
})

test('a paused engine offers a step', () => {
  const html = renderMarkup(<EnginePanel status={{ ...RUNNING, paused: true }} />)
  expect(html).toContain('Step')
  expect(html).toContain('Resume')
})

test('a tick error is surfaced, not swallowed', () => {
  const html = renderMarkup(<EnginePanel status={{ ...RUNNING, lastError: 'ledger unreachable' }} />)
  expect(html).toContain('ledger unreachable')
  expect(html).toContain('role="alert"')
})

test('an engine that has never ticked says so rather than showing blanks', () => {
  const html = renderMarkup(
    <EnginePanel
      status={{ ...RUNNING, nextAction: null, lastAction: null, lastDispatchedAt: null, lastTickAt: null }}
    />,
  )
  // A blank cell reads as a value of zero or as a broken panel. The scheduler runs as
  // its own process, so "not started" is a state an operator will genuinely meet.
  expect(html).toContain('Not started yet')
  expect(html).not.toContain('WriteCall')
})

test('a failed control write is reported next to the buttons that failed', () => {
  const html = renderMarkup(
    <EnginePanel status={RUNNING} actionError="cannot reach the ledger backend" />,
  )
  // Distinct from lastError, which is the engine's own fault: this one says the click
  // never landed, so the state on screen is still the state before it.
  expect(html).toContain('cannot reach the ledger backend')
  expect(html).toContain('role="alert"')
})
