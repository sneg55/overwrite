import { afterEach, expect, mock, test } from 'bun:test'

// Deliberately does NOT mock '@/lib/ledger-api'. That module is also imported
// directly by write-actions.test.ts (the real transport) and by ledger-view.test.ts
// (its own mock.module of readAs/mapResult). Bun's mock.module mutates a module's
// shared exports in place, and that mutation is visible process-wide, not scoped to
// this file, so it would corrupt those other suites regardless of run order. This
// file uses the same safe pattern withdraw-actions.test.ts already uses for the real
// writeAs: stub `globalThis.fetch` and let the real ledger-api.ts run. Only
// '@/lib/party-session' and 'next/cache' are mock.module'd here, matching that file,
// and nothing else in this suite imports either.
const getActingParty = mock(async () => 'alice')
const revalidatePath = mock((_path: string) => {})
mock.module('@/lib/party-session', () => ({ getActingParty }))
mock.module('next/cache', () => ({ revalidatePath }))

const { submitDepositAction } = await import('@/lib/deposit-actions')

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

// Route the backend by path: GET /current-vault resolves the live vault, POST /deposit
// is the write. `vault` overrides the current-vault body; `deposit` overrides the write
// response. Captures the deposit request so tests can assert the resolved cid was used.
function stubBackend(opts: {
  vault?: { body?: unknown; status?: number }
  deposit?: { body?: unknown; status?: number }
}): { deposited: () => { url: string; init: RequestInit } | null } {
  let captured: { url: string; init: RequestInit } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    if (String(url).includes('/current-vault')) {
      return jsonResponse(
        opts.vault?.body ?? { contractId: 'v-live', windowState: 'Open', epochNumber: 1 },
        opts.vault?.status ?? 200,
      )
    }
    captured = { url: String(url), init }
    return jsonResponse(opts.deposit?.body ?? { ok: true }, opts.deposit?.status ?? 200)
  }) as unknown as typeof fetch
  return { deposited: () => captured }
}

test('submitDepositAction requires a cbtc holding cid', async () => {
  const { deposited } = stubBackend({})
  const r = await submitDepositAction({ status: 'idle', message: '' }, new FormData())
  expect(r.status).toBe('error')
  expect(deposited()).toBeNull()
})

test('submitDepositAction requires a positive amount', async () => {
  const { deposited } = stubBackend({})
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1') // holding chosen, but no amount entered
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('error')
  expect(r.message).toContain('amount')
  expect(deposited()).toBeNull()
})

test('submitDepositAction fails clearly when there is no active vault', async () => {
  const { deposited } = stubBackend({ vault: { body: { error: 'no active vault' }, status: 404 } })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '1')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('error')
  expect(r.message).toContain('vault')
  expect(deposited()).toBeNull()
})

test('submitDepositAction blocks the deposit when the window is closed', async () => {
  const { deposited } = stubBackend({
    vault: { body: { contractId: 'v-live', windowState: 'Locked', epochNumber: 2 } },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '1')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('error')
  expect(r.message).toContain('closed')
  expect(deposited()).toBeNull()
})

test('submitDepositAction posts the resolved vault cid + cbtcCid + amount as the session party', async () => {
  const { deposited } = stubBackend({
    vault: { body: { contractId: 'v-live', windowState: 'Open', epochNumber: 1 } },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '1.5')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)

  const seen = deposited()
  expect(r.status).toBe('ok')
  expect(seen?.url).toContain('/deposit')
  expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer demo-alice')
  expect(seen?.init.method).toBe('POST')
  expect(seen?.init.body).toBe(
    JSON.stringify({ vaultCid: 'v-live', cbtcCid: 'c-1', amountCbtc: '1.5' }),
  )
  expect(revalidatePath).toHaveBeenCalledWith('/app/position')
})

// The vault enforces minDepositCbtc itself, but a rejection there arrives as an opaque
// HTTP 400 from the command submission ("deposit failed"). Checking it here, where the
// bound is known, is what lets the message name the actual rule.
test('submitDepositAction refuses an amount below the vault minimum, naming it', async () => {
  const { deposited } = stubBackend({
    vault: {
      body: { contractId: 'v-live', windowState: 'Open', epochNumber: 1, minDepositCbtc: '0.001' },
    },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '0.00000001')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('error')
  expect(r.message).toContain('0.001')
  // Never reached the ledger: the point is to fail before the write, not after it.
  expect(deposited()).toBeNull()
})

test('submitDepositAction accepts an amount exactly at the minimum', async () => {
  const { deposited } = stubBackend({
    vault: {
      body: { contractId: 'v-live', windowState: 'Open', epochNumber: 1, minDepositCbtc: '0.001' },
    },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '0.001')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('ok')
  expect(deposited()).not.toBeNull()
})

// A vault response with no minimum must not invent one, or the form would block
// deposits the ledger would have taken.
test('submitDepositAction asserts no minimum when the vault does not state one', async () => {
  const { deposited } = stubBackend({
    vault: { body: { contractId: 'v-live', windowState: 'Open', epochNumber: 1 } },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '0.00000001')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r.status).toBe('ok')
  expect(deposited()).not.toBeNull()
})

test('submitDepositAction surfaces a backend rejection', async () => {
  stubBackend({
    deposit: { body: { error: 'deposit failed', detail: 'deposit: below minimum' }, status: 502 },
  })
  const fd = new FormData()
  fd.set('cbtcCid', 'c-1')
  fd.set('amountCbtc', '1')
  const r = await submitDepositAction({ status: 'idle', message: '' }, fd)
  expect(r).toEqual({ status: 'error', message: 'deposit: below minimum' })
})
