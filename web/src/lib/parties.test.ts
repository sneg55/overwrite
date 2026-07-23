import { expect, test } from 'bun:test'
import { normalizePartyHint, PARTIES, PARTY_LANDING, type Party } from '@/lib/parties'

test('every party has a landing page', () => {
  for (const p of PARTIES) {
    expect(typeof PARTY_LANDING[p]).toBe('string')
    expect(PARTY_LANDING[p].startsWith('/')).toBe(true)
  }
})

test('every party lands inside the app, never on the public marketing page', () => {
  for (const p of PARTIES) {
    expect(PARTY_LANDING[p].startsWith('/app')).toBe(true)
  }
})

test('depositors land on their own position, not the operator-only vault', () => {
  const depositors: Party[] = ['alice', 'bob', 'carol']
  for (const d of depositors) {
    expect(PARTY_LANDING[d]).toBe('/app/position')
  }
})

test('operator, market maker, and observer land on the vault overview', () => {
  expect(PARTY_LANDING.operator).toBe('/app')
  expect(PARTY_LANDING['mm-buyer']).toBe('/app')
  expect(PARTY_LANDING.observer).toBe('/app')
})

// A shared participant namespaces party hints to avoid colliding with other teams, so
// devnet allocates `alice-overwrite` where this app means `alice`. Without normalisation
// the depositor's own-position filter, the withdraw ownership check and the premium join
// all silently stop matching, and the depositor sees an empty book that looks exactly
// like the privacy model working.

test('strips the configured namespace suffix back to the app party name', () => {
  expect(normalizePartyHint('alice-overwrite', '-overwrite')).toBe('alice')
  expect(normalizePartyHint('mm-buyer-overwrite', '-overwrite')).toBe('mm-buyer')
  expect(normalizePartyHint('observer-overwrite', '-overwrite')).toBe('observer')
})

test('every party survives a round trip through the suffix', () => {
  for (const p of PARTIES) {
    expect(normalizePartyHint(`${p}-overwrite`, '-overwrite')).toBe(p)
  }
})

test('a local sandbox hint is unchanged, with or without a suffix configured', () => {
  expect(normalizePartyHint('alice', '-overwrite')).toBe('alice')
  expect(normalizePartyHint('alice', undefined)).toBe('alice')
  expect(normalizePartyHint('alice', '')).toBe('alice')
})

test('no suffix configured leaves a namespaced hint alone rather than guessing', () => {
  expect(normalizePartyHint('alice-overwrite', undefined)).toBe('alice-overwrite')
})

// Stripping is gated on the remainder being a party we know, so an unrelated party is
// never silently rewritten into one of ours.
test('does not rewrite a foreign party that happens to end in the suffix', () => {
  expect(normalizePartyHint('mallory-overwrite', '-overwrite')).toBe('mallory-overwrite')
  expect(normalizePartyHint('-overwrite', '-overwrite')).toBe('-overwrite')
})

test('leaves the operator UUID hint alone', () => {
  const uuid = 'f265406c-8bc1-4c70-b2fc-29580bcac713'
  expect(normalizePartyHint(uuid, '-overwrite')).toBe(uuid)
})
