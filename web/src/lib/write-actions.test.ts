import { afterEach, expect, test } from 'bun:test'
import { writeAs } from '@/lib/ledger-api'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

test('writeAs posts JSON as the demo bearer for the party', async () => {
  let seen: { url: string; init: RequestInit } | null = null
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    seen = { url, init }
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch

  const r = await writeAs('alice', 'queue-withdraw', { positionCid: 'pos-9' })
  expect(r.ok).toBe(true)
  expect(seen?.url).toContain('/queue-withdraw')
  expect((seen?.init.headers as Record<string, string>).authorization).toBe('Bearer demo-alice')
  expect(seen?.init.method).toBe('POST')
  expect(seen?.init.body).toBe(JSON.stringify({ positionCid: 'pos-9' }))
})

test('writeAs surfaces the backend detail on a non-2xx', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'deposit failed', detail: 'window not Open' }), { status: 502, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch

  const r = await writeAs('alice', 'deposit', { vaultCid: 'v', cbtcCid: 'c' })
  expect(r).toEqual({ ok: false, error: 'window not Open' })
})

test('writeAs reports an unreachable backend distinctly', async () => {
  globalThis.fetch = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch

  const r = await writeAs('alice', 'deposit', {})
  expect(r).toEqual({ ok: false, error: 'cannot reach the ledger backend' })
})
