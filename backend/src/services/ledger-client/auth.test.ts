import { describe, expect, test } from 'bun:test'
import { TokenCache, type TokenResponse } from './auth'

function counter(): { fetcher: () => Promise<TokenResponse>; calls: () => number } {
  let n = 0
  return {
    fetcher: () => {
      n++
      return Promise.resolve({ access_token: `token-${n}`, expires_in: 300 })
    },
    calls: () => n,
  }
}

describe('TokenCache', () => {
  test('fetches once, then serves from cache within validity', async () => {
    const c = counter()
    let clock = 0
    const cache = new TokenCache(c.fetcher, () => clock, 30_000)

    expect(await cache.get()).toBe('token-1')
    clock = 100_000 // 100s later, well within the 300s token
    expect(await cache.get()).toBe('token-1')
    expect(c.calls()).toBe(1)
  })

  test('refreshes once past expiry minus skew', async () => {
    const c = counter()
    let clock = 0
    const cache = new TokenCache(c.fetcher, () => clock, 30_000)

    expect(await cache.get()).toBe('token-1')
    // token valid 300s; skew 30s -> refresh at >= 270s
    clock = 271_000
    expect(await cache.get()).toBe('token-2')
    expect(c.calls()).toBe(2)
  })
})
