import { expect, mock, test } from 'bun:test'

// Mock the REST reader so these tests are pure mapping tests. The mock is installed
// before ledger-view is imported so the module binds to the mocked readAs.
const readAs = mock(async (_party: string, _route: string) => ({ ok: true, data: [] as unknown[] }))
const readHoldingsAs = mock(async (_party: string) => ({ ok: true, data: [] as unknown[] }))
mock.module('@/lib/ledger-api', () => ({
  readAs,
  readHoldingsAs,
  mapResult: <A, B>(r: { ok: boolean; data?: A; error?: string }, f: (a: A) => B) =>
    r.ok ? { ok: true, data: f(r.data as A) } : r,
}))

const { vaultFor, positionsFor, reportsFor, windowStateFor, holdingsFor, toReportView } = await import('@/lib/ledger-view')

test('vaultFor exposes notionalCbtc and never invents optionState', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'opt-1', payload: { notionalCbtc: '3', epochNumber: '7', strikeUsdcPerCbtc: '70000', premiumUsdc: '900', expiry: '2026-07-15T14:00:00Z' } }],
  })
  const r = await vaultFor('operator')
  expect(r).toEqual({
    ok: true,
    data: { notionalCbtc: 3, epochNumber: 7, strikeUsdPerCbtc: 70000, premiumUsdc: 900, optionState: 'unknown', expiryIso: '2026-07-15T14:00:00Z' },
  })
})

test('vaultFor keeps a real optionState when present', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'opt-1', payload: { notionalCbtc: '3', epochNumber: '7', strikeUsdcPerCbtc: '70000', premiumUsdc: '900', state: 'Active', expiry: '2026-07-15T14:00:00Z' } }],
  })
  const r = await vaultFor('operator')
  expect(r.ok && r.data?.optionState).toBe('Active')
})

// Devnet namespaces party hints (`alice-overwrite::ns`), and the depositor field is what
// the position filter, the withdraw ownership check and the premium join all compare
// against a `Party`. If it arrives un-normalised those comparisons quietly stop matching
// and the depositor sees an empty book, which in a privacy demo is indistinguishable from
// the ledger correctly showing them nothing. Hence a test at this layer, not just on the
// pure helper.
test('positionsFor normalises a namespaced devnet depositor hint', async () => {
  process.env.OVERWRITE_PARTY_HINT_SUFFIX = '-overwrite'
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'pos-1', payload: { depositor: 'alice-overwrite::ns', principalCbtc: '1', epochNumber: '1', withdrawQueued: false } }],
  })
  const r = await positionsFor('alice')
  expect(r.ok && r.data?.[0]?.depositor).toBe('alice')
  process.env.OVERWRITE_PARTY_HINT_SUFFIX = undefined
})

test('positionsFor leaves the hint alone when no suffix is configured', async () => {
  process.env.OVERWRITE_PARTY_HINT_SUFFIX = undefined
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'pos-1', payload: { depositor: 'alice::ns', principalCbtc: '1', epochNumber: '1', withdrawQueued: false } }],
  })
  const r = await positionsFor('alice')
  expect(r.ok && r.data?.[0]?.depositor).toBe('alice')
})

test('positionsFor carries the contractId through', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'pos-9', payload: { depositor: 'alice::ns', principalCbtc: '1', epochNumber: '7', withdrawQueued: false } }],
  })
  const r = await positionsFor('alice')
  expect(r).toEqual({ ok: true, data: [{ contractId: 'pos-9', depositor: 'alice', principalCbtc: 1, epochNumber: 7, withdrawQueued: false }] })
})

test('reportsFor marks an absent settlementPath unknown', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'rep-1', payload: { epochNumber: '5', totalPremiumUsdc: '800', totalNotionalCbtc: '3', depositorCount: '3', collateralReturned: true } }],
  })
  const r = await reportsFor('operator')
  expect(r.ok && r.data[0]?.settlementPath).toBe('unknown')
})

test('holdingsFor maps the CBTC wallet balance and never invents an amount', async () => {
  readHoldingsAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'h-1', amount: '2.0', instrument: 'CBTC' }],
  })
  const r = await holdingsFor('alice')
  expect(r).toEqual({ ok: true, data: [{ contractId: 'h-1', amountCbtc: 2, instrument: 'CBTC' }] })
})

test('holdingsFor returns an empty wallet as [], distinct from a read failure', async () => {
  readHoldingsAs.mockResolvedValueOnce({ ok: true, data: [] })
  const empty = await holdingsFor('observer')
  expect(empty).toEqual({ ok: true, data: [] })

  readHoldingsAs.mockResolvedValueOnce({ ok: false, error: 'cannot reach the ledger backend' })
  const failed = await holdingsFor('alice')
  expect(failed).toEqual({ ok: false, error: 'cannot reach the ledger backend' })
})

// The payload keys here must match what the Vault template actually emits. This test
// previously fed `depositWindowState`, the same non-existent key the reader was asking
// for, so the pair agreed with each other and disagreed with the ledger: the window read
// as "Not recorded" on every real epoch while this stayed green. Fixture keys copied from
// a live `GET /vault` response.
test('windowStateFor returns the observed Vault window, or null when unseen', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [
      {
        contractId: 'v-1',
        payload: { epochNumber: '7', windowState: 'Open', totalPooledCbtc: '3.5000000000' },
      },
    ],
  })
  const seen = await windowStateFor('operator')
  expect(seen).toEqual({ ok: true, data: { epochNumber: 7, windowState: 'Open', pooledCbtc: 3.5 } })

  readAs.mockResolvedValueOnce({ ok: true, data: [] })
  const unseen = await windowStateFor('alice')
  expect(unseen).toEqual({ ok: true, data: null })
})

// A Vault whose window is some value this UI does not model must read as 'unknown', not
// as a plausible default. Guards the mapper, not the key name.
test('windowStateFor reports an unmodelled window state as unknown', async () => {
  readAs.mockResolvedValueOnce({
    ok: true,
    data: [{ contractId: 'v-1', payload: { epochNumber: '7', windowState: 'Paused' } }],
  })
  expect(await windowStateFor('operator')).toEqual({
    ok: true,
    data: { epochNumber: 7, windowState: 'unknown', pooledCbtc: 0 },
  })
})

test('a report carries the settlement facts it was written with', () => {
  // Payload shape taken from a live GET /reports response, not invented. A fixture
  // built on a guessed key would agree with a reader that guessed the same key and
  // disagree with the ledger, which is exactly how the deposit-window bug survived
  // its own test. Optional Decimal serializes as a bare decimal string when Some
  // (confirmed live: observedPrice '66067.6250000000').
  const view = toReportView({
    epochNumber: '3',
    settlementPath: 'OTM',
    totalPremiumUsdc: '1240.0',
    totalNotionalCbtc: '2.5',
    depositorCount: '3',
    collateralReturned: true,
    observedPrice: '64000.0',
    strikeUsdcPerCbtc: '66000.0',
  })
  expect(view.observedPrice).toBe(64000)
  expect(view.strikeUsdcPerCbtc).toBe(66000)
})

test('a report from the pre-upgrade package reports null, never zero', () => {
  // overwrite-vault 1.0.0 wrote no such field. Coercing that absence to 0 would state
  // a settlement price of zero dollars that nobody ever observed.
  const view = toReportView({
    epochNumber: '1',
    settlementPath: 'OTM',
    totalPremiumUsdc: '900.0',
    totalNotionalCbtc: '2.0',
    depositorCount: '2',
    collateralReturned: true,
  })
  expect(view.observedPrice).toBeNull()
  expect(view.strikeUsdcPerCbtc).toBeNull()
})
