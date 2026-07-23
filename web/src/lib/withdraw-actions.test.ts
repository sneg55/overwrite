import { afterEach, expect, mock, test } from 'bun:test'

// Deliberately does NOT mock '@/lib/ledger-api'. That module is also imported
// directly by write-actions.test.ts (the real transport) and by ledger-view.test.ts
// (its own mock.module of readAs/mapResult). Bun's mock.module mutates a module's
// shared exports in place, and that mutation is visible process-wide, not scoped to
// this file: an earlier version of this file mock.module'd '@/lib/ledger-api' to
// `{ writeAs }` and it corrupted both of those other files (write-actions.test.ts
// started getting this file's mocked writeAs, and ledger-view.test.ts lost its
// mapResult export), regardless of which file ran first. So this file uses the same
// safe pattern write-actions.test.ts already uses for the real writeAs: stub
// `globalThis.fetch` and let the real ledger-api.ts run. Only '@/lib/party-session'
// and 'next/cache' are mock.module'd here, and nothing else in this suite imports
// either, so there is no shared registry for those two to corrupt.
const getActingParty = mock(async () => 'alice')
const revalidatePath = mock((_path: string) => {})
mock.module('@/lib/party-session', () => ({ getActingParty }))
mock.module('next/cache', () => ({ revalidatePath }))

const { queueWithdrawAction } = await import('@/lib/withdraw-actions')

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

test('queueWithdrawAction rejects a missing position reference before any write', async () => {
  let fetchCalled = false
  globalThis.fetch = (async () => {
    fetchCalled = true
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

  const r = await queueWithdrawAction({ status: 'idle', message: '' }, new FormData())
  expect(r.status).toBe('error')
  expect(fetchCalled).toBe(false)
})

test('queueWithdrawAction calls the backend as the session party and revalidates', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

  const fd = new FormData()
  fd.set('positionCid', 'pos-9')
  const r = await queueWithdrawAction({ status: 'idle', message: '' }, fd)

  expect(r.status).toBe('ok')
  expect(seen?.url).toContain('/queue-withdraw')
  expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer demo-alice')
  expect(seen?.init.method).toBe('POST')
  expect(seen?.init.body).toBe(JSON.stringify({ positionCid: 'pos-9' }))
  expect(revalidatePath).toHaveBeenCalledWith('/app/position')
})

test('queueWithdrawAction surfaces a backend rejection', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'not your position' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch

  const fd = new FormData()
  fd.set('positionCid', 'pos-9')
  const r = await queueWithdrawAction({ status: 'idle', message: '' }, fd)
  expect(r).toEqual({ status: 'error', message: 'not your position' })
})
