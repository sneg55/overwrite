// Scheduler configuration, resolved once from the env boundary at the entrypoint.
// Kept as a plain value (not the env object) so reads/handlers/loop stay pure and
// unit-testable without importing the env module.

import { env } from '@/utils/env'

export interface SchedulerConfig {
  operator: string
  oracle: string
  mmBuyer: string
  cashInstrument: string
  epochLengthMs: number
  depositWindowMs: number
  tickMs: number
  premiumBps: number
  allocateWindowMs: number
  settleBufferMs: number
  useRealRegistry: boolean
  registryUrl: string
  registrar: string
}

export function schedulerConfigFromEnv(): SchedulerConfig {
  return {
    operator: env.OPERATOR_PARTY,
    oracle: env.ORACLE_PARTY,
    mmBuyer: env.MM_BUYER_PARTY,
    cashInstrument: env.CASH_INSTRUMENT,
    epochLengthMs: env.EPOCH_LENGTH_MS,
    depositWindowMs: env.DEPOSIT_WINDOW_MS,
    tickMs: env.TICK_MS,
    premiumBps: env.PREMIUM_BPS,
    allocateWindowMs: env.ALLOCATE_WINDOW_MS,
    settleBufferMs: env.SETTLE_BUFFER_MS,
    useRealRegistry: env.USE_REAL_REGISTRY,
    registryUrl: env.REGISTRY_URL,
    registrar: env.CBTC_NETWORK_PARTY,
  }
}
