import { describe, expect, test } from 'bun:test'
import { delay } from './async'

describe('delay', () => {
  test('resolves after the interval', async () => {
    const start = Date.now()
    await delay(20)
    expect(Date.now() - start).toBeGreaterThanOrEqual(15)
  })

  test('resolves immediately when the signal is already aborted', async () => {
    const ac = new AbortController()
    ac.abort()
    const start = Date.now()
    await delay(1_000, ac.signal)
    expect(Date.now() - start).toBeLessThan(200)
  })

  test('resolves early when aborted mid-wait', async () => {
    const ac = new AbortController()
    const p = delay(1_000, ac.signal)
    setTimeout(() => ac.abort(), 10)
    const start = Date.now()
    await p
    expect(Date.now() - start).toBeLessThan(300)
  })
})
