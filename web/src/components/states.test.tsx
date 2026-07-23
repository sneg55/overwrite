import { expect, test } from 'bun:test'
import { EmptyState, ErrorState, NotVisible } from '@/components/states'
import { renderMarkup } from '@/test/render'

test('NotVisible states the absence rather than implying it by omission', () => {
  const html = renderMarkup(<NotVisible />)
  expect(html).toContain('Not visible to this party')
})

test('an error still looks different from an empty ledger answer', () => {
  // The distinction is a correctness concern, not a style one: an outage must never
  // render like a privacy-scoped empty result, or the UI asserts a fact it never observed.
  const err = renderMarkup(<ErrorState detail="connection refused" />)
  const empty = renderMarkup(<EmptyState title="Nothing here">body</EmptyState>)
  expect(err).toContain('Cannot reach the ledger')
  expect(err).toContain('role="alert"')
  expect(empty).not.toContain('Cannot reach the ledger')
})
