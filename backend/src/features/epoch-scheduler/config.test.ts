import { describe, expect, test } from 'bun:test'
import type { SchedulerConfig } from './config'

// The type is the contract later tasks depend on; assert its shape structurally.
describe('SchedulerConfig', () => {
  test('has the fields handlers/reads/loop consume', () => {
    const c: SchedulerConfig = {
      operator: 'op',
      oracle: 'or',
      mmBuyer: 'mm',
      cashInstrument: 'mUSDC',
      epochLengthMs: 20_000,
      depositWindowMs: 0,
      tickMs: 2_000,
      premiumBps: 100,
      allocateWindowMs: 86_400_000,
      settleBufferMs: 3_600_000,
      useRealRegistry: false,
      registryUrl: 'https://registry.test',
      registrar: 'registrar',
    }
    expect(c.operator).toBe('op')
    expect(c.premiumBps).toBe(100)
  })
})
