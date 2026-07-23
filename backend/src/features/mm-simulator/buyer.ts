// Market-maker on-ledger actions (acts as mmBuyer). SIMULATED and labeled everywhere.
// The MM is a separate process and party from the operator: it is the ONLY caller of
// PayPremium, and (on the forced-ITM demo path) the party that allocates strike cash.
// The MM is funded once by the operator (mock-USDCx issuance); it carves exact chunks
// from that balance via Split. Premium is a demo parameter read off the option, never
// a priced quote.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { parseDecimal, toDecimal } from '@/services/decimal'
import type { ActiveContract } from '@/services/ledger-client/parse'
import { cmdId, type LedgerSession } from '@/services/ledger-client/session'
import { createdOf } from '@/services/ledger-client/tx'
import { env } from '@/utils/env'

export interface MmConfig {
  mmBuyer: string
  operator: string
  cashInstrument: string
  pollMs: number
  // Same labeled demo price schedule the oracle uses, so the MM's exercise decision
  // agrees with the settlement observation without reading the ledger. Unset means
  // the MM decides from live public spot (the real path).
  demoPrice?: string
  demoLate?: string
  demoSwitchMs?: number
}

export function mmConfigFromEnv(): MmConfig {
  return {
    mmBuyer: env.MM_BUYER_PARTY,
    operator: env.OPERATOR_PARTY,
    cashInstrument: env.CASH_INSTRUMENT,
    pollMs: env.TICK_MS,
    demoPrice: env.ORACLE_DEMO_PRICE,
    demoLate: env.ORACLE_DEMO_PRICE_LATE,
    demoSwitchMs: env.ORACLE_DEMO_SWITCH_MS,
  }
}

export interface MmOption {
  cid: string
  state: string
  premiumUsdc: string
  strike: string
  expiryMs: number
  notionalCbtc: string
}

const s = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

export function parseMmOptions(cs: ActiveContract[]): MmOption[] {
  return cs.map((c) => ({
    cid: c.contractId,
    state: s(c.payload.state),
    premiumUsdc: s(c.payload.premiumUsdc),
    strike: s(c.payload.strikeUsdcPerCbtc),
    expiryMs: Date.parse(s(c.payload.expiry)),
    notionalCbtc: s(c.payload.notionalCbtc),
  }))
}

interface FundHolding {
  cid: string
  amount: string
}

async function mmCashHolding(
  session: LedgerSession,
  cfg: MmConfig,
): Promise<FundHolding | undefined> {
  const hs = await session.query(cfg.mmBuyer, 'Allocation', 'Holding')
  return hs
    .filter(
      (h) => s(h.payload.owner) === cfg.mmBuyer && s(h.payload.instrument) === cfg.cashInstrument,
    )
    .map((h) => ({ cid: h.contractId, amount: s(h.payload.amount) }))
    .reduce<FundHolding | undefined>(
      (best, h) =>
        best === undefined || parseDecimal(h.amount) > parseDecimal(best.amount) ? h : best,
      undefined,
    )
}

async function carveExact(
  session: LedgerSession,
  cfg: MmConfig,
  fund: FundHolding,
  amount: string,
): Promise<string> {
  if (Math.abs(parseDecimal(fund.amount) - parseDecimal(amount)) < 1e-9) return fund.cid
  const split = await session.exercise({
    module: 'Allocation',
    template: 'Holding',
    contractId: fund.cid,
    choice: 'Split',
    choiceArgument: { splitAmount: amount },
    actAs: [cfg.mmBuyer],
    commandId: cmdId('mm-split'),
  })
  const first = createdOf(split, 'Allocation', 'Holding')[0]?.contractId
  if (first === undefined)
    throw new AppError(
      ErrorIds.MM_NO_FUNDS,
      `${ErrorIds.MM_NO_FUNDS}: mm: split produced no holding`,
    )
  return first
}

export async function payPremiumFor(
  session: LedgerSession,
  cfg: MmConfig,
  opt: MmOption,
): Promise<void> {
  if (opt.state !== 'Written') return
  const fund = await mmCashHolding(session, cfg)
  if (fund === undefined || parseDecimal(fund.amount) < parseDecimal(opt.premiumUsdc)) {
    throw new AppError(
      ErrorIds.MM_NO_FUNDS,
      `${ErrorIds.MM_NO_FUNDS}: mm: insufficient cash to pay premium`,
      { need: opt.premiumUsdc },
    )
  }
  const premiumCid = await carveExact(session, cfg, fund, opt.premiumUsdc)
  await session.exercise({
    module: 'CallOption',
    template: 'CallOption',
    contractId: opt.cid,
    choice: 'PayPremium',
    choiceArgument: { premiumCid },
    actAs: [cfg.mmBuyer],
    commandId: cmdId('mm-pay'),
  })
}

// True if the MM already holds an allocated strike-cash leg of this size for the
// operator to settle. The allocation (sender = mmBuyer) persists until SettleITM
// consumes it and the option together, so its presence means we have already
// allocated for the in-flight option and must not carve a second one.
async function hasStrikeAllocation(
  session: LedgerSession,
  cfg: MmConfig,
  strikeCash: string,
): Promise<boolean> {
  const existing = await session.query(cfg.mmBuyer, 'Allocation', 'MockAllocation')
  return existing.some(
    (c) =>
      s(c.payload.sender) === cfg.mmBuyer &&
      s(c.payload.instrument) === cfg.cashInstrument &&
      Math.abs(parseDecimal(s(c.payload.amount)) - parseDecimal(strikeCash)) < 1e-9,
  )
}

// Returns true if it allocated a fresh strike-cash leg, false if it skipped because one
// already exists (so the caller can log/observe only real allocations).
export async function allocateStrikeFor(
  session: LedgerSession,
  cfg: MmConfig,
  opt: MmOption,
): Promise<boolean> {
  const strikeCash = toDecimal(parseDecimal(opt.strike) * parseDecimal(opt.notionalCbtc))
  // Fire once per option: the loop re-sees the same expired, in-the-money option every
  // tick until the operator settles it, and re-carving strike cash each time would drain
  // the MM fund and strand duplicate locked allocations.
  if (await hasStrikeAllocation(session, cfg, strikeCash)) return false
  const fund = await mmCashHolding(session, cfg)
  if (fund === undefined || parseDecimal(fund.amount) < parseDecimal(strikeCash)) {
    throw new AppError(
      ErrorIds.MM_NO_FUNDS,
      `${ErrorIds.MM_NO_FUNDS}: mm: insufficient cash to allocate strike`,
      { need: strikeCash },
    )
  }
  const cashCid = await carveExact(session, cfg, fund, strikeCash)
  // Generous demo windows (the real registry sets these off expiry + settleBufferSeconds;
  // this in-memory path just needs allocateBefore/settleBefore in the future).
  const requestedAt = new Date()
  const allocateBefore = new Date(requestedAt.getTime() + 24 * 60 * 60 * 1000)
  const settleBefore = new Date(requestedAt.getTime() + 48 * 60 * 60 * 1000)
  await session.exercise({
    module: 'Allocation',
    template: 'Holding',
    contractId: cashCid,
    choice: 'Allocate',
    choiceArgument: {
      executor: cfg.operator,
      receiver: cfg.operator,
      allocateBefore: allocateBefore.toISOString(),
      settleBefore: settleBefore.toISOString(),
      requestedAt: requestedAt.toISOString(),
    },
    actAs: [cfg.mmBuyer],
    commandId: cmdId('mm-alloc'),
  })
  return true
}
