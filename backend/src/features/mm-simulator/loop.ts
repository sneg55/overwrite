// The MM process loop (acts as mmBuyer). It watches the options it can see (observer =
// mmBuyer) and: pays premium on a freshly Written option; at expiry, decides rationally
// (buys ITM, walks OTM) and, when buying, allocates the strike cash for the operator to
// settle atomically. Separate process + party from the operator keeps "two independent
// counterparties" honest; the MM never exercises the operator's or oracle's choices.

import { isAppError } from '@/constants/errorIds'
import { fetchBtcSpot } from '@/features/oracle-poller/price-source'
import { delay } from '@/services/async'
import { parseDecimal } from '@/services/decimal'
import { type DemoPriceSchedule, demoPriceAt } from '@/services/demo-price'
import type { LedgerSession } from '@/services/ledger-client/session'
import {
  allocateStrikeFor,
  type MmConfig,
  type MmOption,
  parseMmOptions,
  payPremiumFor,
} from './buyer'
import { decideExercise } from './decide'

export type MmObserver = (action: string, optionCid: string) => void

// The MM's view of spot. In demo mode it reads the SAME labeled schedule the oracle
// observes, so its exercise decision agrees with the settlement price; otherwise it uses
// live public spot (the real path).
async function mmSpot(
  schedule: DemoPriceSchedule | undefined,
  startMs: number,
  signal: AbortSignal,
): Promise<number> {
  if (schedule !== undefined) return parseDecimal(demoPriceAt(schedule, Date.now() - startMs))
  return (await fetchBtcSpot(signal)).priceUsd
}

// One option's turn: pay premium on a fresh write, or at expiry decide rationally and
// (when buying) allocate the strike cash. Guard clauses keep this flat and cheap.
async function handleOption(
  session: LedgerSession,
  cfg: MmConfig,
  opt: MmOption,
  resolveSpot: () => Promise<number>,
  onAct?: MmObserver,
): Promise<void> {
  if (opt.state === 'Written') {
    await payPremiumFor(session, cfg, opt)
    onAct?.('PayPremium', opt.cid)
    return
  }
  if (opt.state !== 'Active' || Date.now() < opt.expiryMs) return
  if (decideExercise(await resolveSpot(), parseDecimal(opt.strike)) !== 'exercise') return
  // Only announce a real allocation; the guard skips ticks after the first, so firing
  // onAct unconditionally would log one AllocateStrike per tick until settlement.
  if (await allocateStrikeFor(session, cfg, opt)) onAct?.('AllocateStrike', opt.cid)
}

export async function runMm(
  session: LedgerSession,
  cfg: MmConfig,
  signal: AbortSignal,
  onAct?: MmObserver,
): Promise<void> {
  const startMs = Date.now()
  const schedule =
    cfg.demoPrice !== undefined
      ? { base: cfg.demoPrice, late: cfg.demoLate, switchMs: cfg.demoSwitchMs }
      : undefined
  const resolveSpot = (): Promise<number> => mmSpot(schedule, startMs, signal)
  while (!signal.aborted) {
    try {
      const options = parseMmOptions(await session.query(cfg.mmBuyer, 'CallOption', 'CallOption'))
      for (const opt of options) await handleOption(session, cfg, opt, resolveSpot, onAct)
    } catch (e) {
      const line = isAppError(e) ? e.toLogLine() : e instanceof Error ? e.message : String(e)
      console.error(`[mm] loop error: ${line}`)
    }
    await delay(cfg.pollMs, signal)
  }
}
