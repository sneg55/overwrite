import { describe, expect, test } from 'bun:test'
import { envSchema } from './env'

const minimal = {
  LEDGER_API_URL: 'http://localhost:7575',
  REGISTRY_URL: 'http://localhost',
  CBTC_NETWORK_PARTY: 'x',
  OPERATOR_PARTY: 'operator',
  ORACLE_PARTY: 'oracle',
  MM_BUYER_PARTY: 'mm',
}

describe('envSchema engine defaults', () => {
  test('supplies compressed-epoch defaults', () => {
    const env = envSchema.parse(minimal)
    expect(env.EPOCH_LENGTH_MS).toBeGreaterThan(0)
    expect(env.TICK_MS).toBeGreaterThan(0)
    expect(env.ORACLE_POLL_MS).toBeGreaterThan(0)
    expect(env.PREMIUM_BPS).toBeGreaterThan(0)
    expect(env.STRIKE_PCT).toBeGreaterThan(0)
    expect(env.CASH_INSTRUMENT).toBe('mUSDC')
  })

  test('coerces numeric overrides from strings', () => {
    const env = envSchema.parse({ ...minimal, EPOCH_LENGTH_MS: '30000', PREMIUM_BPS: '150' })
    expect(env.EPOCH_LENGTH_MS).toBe(30000)
    expect(env.PREMIUM_BPS).toBe(150)
  })
})
