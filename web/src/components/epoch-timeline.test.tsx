import { expect, test } from 'bun:test'
import { EpochTimeline } from '@/components/epoch-timeline'
import { renderMarkup } from '@/test/render'

test('timeline names the epoch and marks settlement current when settled', () => {
  const html = renderMarkup(<EpochTimeline epochNumber={7} expiryIso="2026-07-15T14:00:00Z" optionState="Settled" />)
  expect(html).toContain('Epoch 7 lifecycle')
  expect(html).toContain('aria-current="step"')
  expect(html).toContain('Settlement')
})

test('timeline renders a countdown value and the absolute expiry', () => {
  const html = renderMarkup(<EpochTimeline epochNumber={7} expiryIso="2026-07-15T14:00:00Z" optionState="Active" />)
  // The absolute time is always shown; the countdown value is present as a span.
  expect(html).toContain('countdown-value')
  expect(html).toContain('2026-07-15T14:00:00Z')
})

test('an unknown option state is not rendered as any particular phase', () => {
  // types.ts: a field is either genuinely read or explicitly unknown. Rendering
  // `unknown` as "Call live" fills a gap with a guess.
  const html = renderMarkup(
    <EpochTimeline epochNumber={7} expiryIso="2026-07-15T14:00:00Z" optionState="unknown" />,
  )
  expect(html).toContain('is-unknown')
  expect(html).not.toContain('aria-current="step"')
})

test('an open deposit window marks deposits current, not done', () => {
  const html = renderMarkup(
    <EpochTimeline
      epochNumber={7}
      expiryIso="2026-07-15T14:00:00Z"
      optionState="Active"
      windowState="Open"
    />,
  )
  // "Deposits" must not be marked done while the vault is still accepting them.
  expect(html).toContain('timeline-step is-current')
  const depositsIdx = html.indexOf('Deposits')
  const doneIdx = html.indexOf('is-done')
  expect(doneIdx === -1 || doneIdx > depositsIdx).toBe(true)
})

test('a locked window still walks the lifecycle forward', () => {
  const html = renderMarkup(
    <EpochTimeline
      epochNumber={7}
      expiryIso="2026-07-15T14:00:00Z"
      optionState="Active"
      windowState="Locked"
    />,
  )
  expect(html).toContain('is-done')
  expect(html).toContain('aria-current="step"')
})
