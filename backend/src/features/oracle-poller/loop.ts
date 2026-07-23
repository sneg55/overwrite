// The oracle process loop (acts as oracleParty). On each poll it takes a price (real
// public spot, or the labeled demo override), and writes a PriceObservation for the
// live epoch. Publishing continuously means a fresh at-or-after-expiry observation
// always exists shortly after expiry, which is what the scheduler's settle step waits
// for. SIMULATED/self-operated trust model is labeled in UI/README.

import { isAppError } from '@/constants/errorIds'
import { delay } from '@/services/async'
import { toDecimal } from '@/services/decimal'
import { demoPriceAt } from '@/services/demo-price'
import type { LedgerSession } from '@/services/ledger-client/session'
import type { OracleConfig } from './observation-writer'
import { writeObservation } from './observation-writer'
import { fetchBtcSpot } from './price-source'

export type ObsObserver = (price: string, isDemo: boolean, written: boolean) => void

export async function runOracle(
  session: LedgerSession,
  cfg: OracleConfig,
  signal: AbortSignal,
  onWrite?: ObsObserver,
): Promise<void> {
  const startMs = Date.now()
  const schedule =
    cfg.demoPrice !== undefined
      ? { base: cfg.demoPrice, late: cfg.demoLate, switchMs: cfg.demoSwitchMs }
      : undefined
  while (!signal.aborted) {
    try {
      const isDemo = schedule !== undefined
      const price = isDemo
        ? demoPriceAt(schedule, Date.now() - startMs)
        : toDecimal((await fetchBtcSpot(signal)).priceUsd)
      const written = await writeObservation(session, cfg, price, isDemo)
      onWrite?.(price, isDemo, written)
    } catch (e) {
      const line = isAppError(e) ? e.toLogLine() : e instanceof Error ? e.message : String(e)
      console.error(`[oracle] poll error: ${line}`)
    }
    await delay(cfg.pollMs, signal)
  }
}
