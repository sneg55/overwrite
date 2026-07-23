import { describe, expect, test } from 'bun:test'
import { parseCoinbase, parseCoinGecko } from './price-source'

describe('parseCoinbase', () => {
  test('parses a valid spot payload', () => {
    expect(parseCoinbase({ data: { amount: '64250.12', base: 'BTC', currency: 'USD' } })).toBe(
      64250.12,
    )
  })

  test('rejects a wrong shape', () => {
    expect(parseCoinbase({ price: 100 })).toBeNull()
    expect(parseCoinbase(null)).toBeNull()
    expect(parseCoinbase('nope')).toBeNull()
  })

  test('rejects non-positive or non-numeric amounts', () => {
    expect(parseCoinbase({ data: { amount: '0' } })).toBeNull()
    expect(parseCoinbase({ data: { amount: '-5' } })).toBeNull()
    expect(parseCoinbase({ data: { amount: 'abc' } })).toBeNull()
  })
})

describe('parseCoinGecko', () => {
  test('parses a valid payload', () => {
    expect(parseCoinGecko({ bitcoin: { usd: 64250 } })).toBe(64250)
  })

  test('rejects a wrong shape', () => {
    expect(parseCoinGecko({ bitcoin: { eur: 60000 } })).toBeNull()
    expect(parseCoinGecko({})).toBeNull()
  })

  test('rejects non-positive amounts', () => {
    expect(parseCoinGecko({ bitcoin: { usd: 0 } })).toBeNull()
    expect(parseCoinGecko({ bitcoin: { usd: -1 } })).toBeNull()
  })
})
