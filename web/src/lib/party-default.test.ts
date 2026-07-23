import { expect, test } from 'bun:test'
import { resolveDefaultParty } from '@/lib/party-default'

// The cold-load default is security-relevant: a production build (no demo env, no
// cookie) must resolve to `observer` (sees nothing), never leak another party's view.

test('no cookie and no demo env resolves to observer (production-safe)', () => {
  expect(resolveDefaultParty(undefined, undefined)).toBe('observer')
})

test('OVERWRITE_DEMO_DEFAULT_PARTY=operator lands cold load on the operator', () => {
  expect(resolveDefaultParty(undefined, 'operator')).toBe('operator')
})

test('an invalid demo-default value falls back to observer', () => {
  expect(resolveDefaultParty(undefined, 'not-a-party')).toBe('observer')
})

test('a valid cookie always wins over the demo default', () => {
  expect(resolveDefaultParty('carol', 'operator')).toBe('carol')
})

test('an invalid cookie is ignored in favor of the demo default', () => {
  expect(resolveDefaultParty('bogus', 'operator')).toBe('operator')
})
