// Party-scoped projections, sourced from the live ledger (via the REST backend,
// which submits an ACS query AS that party). The ledger enforces visibility; these
// functions only map the returned contract payloads into the UI view shapes. Nothing
// is filtered client-side, so:
//   * operator sees everything
//   * a depositor sees only their own position + receipt (not the vault/option)
//   * mm-buyer sees the CallOption (it is the counterparty), no positions
//   * observer sees NOTHING (the ledger returns an empty ACS)
//
// The vault summary is derived from the CallOption (operator + mm-buyer observe it);
// depositors and the observer cannot see it and get null, which the dashboard renders
// as an honest "not a stakeholder" empty state. The deposit-window state lives on the
// Vault (operator-only) and is read separately by windowStateFor.
//
// A field is read or marked 'unknown'; it is never defaulted to a plausible value.
// Every function returns a LedgerResult: an empty ACS ("the ledger showed this party
// nothing") and a failed read ("we never got an answer") are different facts, and
// collapsing them would let an outage impersonate a privacy proof.

import { type LedgerContract, type LedgerResult, mapResult, readAs, readHoldingsAs } from './ledger-api'
import { normalizePartyHint, type Party } from './parties'
import type {
  EpochReportView,
  HoldingView,
  PositionView,
  ReceiptView,
  VaultView,
  VaultWindowView,
} from './types'

const num = (v: unknown): number => (typeof v === 'string' ? Number.parseFloat(v) : typeof v === 'number' ? v : 0)
const int = (v: unknown): number => (typeof v === 'string' ? Number.parseInt(v, 10) : typeof v === 'number' ? v : 0)
// An Optional Decimal from the ledger. Absent or null stays null; it never collapses
// to 0, because a missing field means "this report predates the field" and a zero
// would mean "the asset settled at zero dollars".
const optNum = (v: unknown): number | null => {
  if (v === null || v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
// A party id is `<hint>::<namespace>`. On a local sandbox the hint is already the friendly
// name; on a shared participant it carries a namespacing suffix (devnet allocates
// `alice-overwrite`), so OVERWRITE_PARTY_HINT_SUFFIX names that suffix and it is stripped
// back to the name this app compares against. See normalizePartyHint for why a mismatch
// here fails silently rather than loudly.
const hint = (v: unknown): string =>
  typeof v === 'string'
    ? normalizePartyHint(v.split('::')[0] ?? v, process.env.OVERWRITE_PARTY_HINT_SUFFIX)
    : String(v)

function optionState(v: unknown): VaultView['optionState'] {
  return v === 'Written' || v === 'Active' || v === 'Settled' ? v : 'unknown'
}

function settlementPath(v: unknown): EpochReportView['settlementPath'] {
  return v === 'OTM' || v === 'ITM' ? v : 'unknown'
}

function windowState(v: unknown): VaultWindowView['windowState'] {
  return v === 'Open' || v === 'Locked' || v === 'Settling' ? v : 'unknown'
}

export async function vaultFor(party: Party): Promise<LedgerResult<VaultView | null>> {
  return mapResult(await readAs(party, 'option'), (contracts) => {
    const opt = contracts[0]
    if (opt === undefined) return null
    const p = opt.payload
    return {
      notionalCbtc: num(p.notionalCbtc),
      epochNumber: int(p.epochNumber),
      strikeUsdPerCbtc: num(p.strikeUsdcPerCbtc),
      premiumUsdc: num(p.premiumUsdc),
      optionState: optionState(p.state),
      expiryIso: typeof p.expiry === 'string' ? p.expiry : new Date().toISOString(),
    }
  })
}

// The Vault template is signatory-operator-only, so only the operator observes the
// deposit window. Any other party gets an empty ACS -> null, and the UI omits the row
// rather than guessing.
export async function windowStateFor(party: Party): Promise<LedgerResult<VaultWindowView | null>> {
  return mapResult(await readAs(party, 'vault'), (contracts) => {
    const v = contracts[0]
    if (v === undefined) return null
    // The Vault payload field is `windowState`. This read used to ask for
    // `depositWindowState`, which no Vault has, so it resolved to undefined and the
    // dashboard reported the window as "Not recorded" on every epoch, including open
    // ones a depositor was actively depositing into.
    return {
      epochNumber: int(v.payload.epochNumber),
      windowState: windowState(v.payload.windowState),
      pooledCbtc: num(v.payload.totalPooledCbtc),
    }
  })
}

export async function positionsFor(party: Party): Promise<LedgerResult<PositionView[]>> {
  return mapResult(await readAs(party, 'positions'), (cs) =>
    cs.map((c: LedgerContract) => ({
      contractId: c.contractId,
      depositor: hint(c.payload.depositor),
      principalCbtc: num(c.payload.principalCbtc),
      epochNumber: int(c.payload.epochNumber),
      withdrawQueued: c.payload.withdrawQueued === true,
    })),
  )
}

export async function receiptsFor(party: Party): Promise<LedgerResult<ReceiptView[]>> {
  return mapResult(await readAs(party, 'receipts'), (cs) =>
    cs.map((c: LedgerContract) => ({
      depositor: hint(c.payload.depositor),
      epochNumber: int(c.payload.epochNumber),
      premiumPaidUsdc: num(c.payload.premiumPaidUsdc),
    })),
  )
}

// The party's free (undeposited) CBTC holdings: their wallet balance. The backend
// route already filters to CBTC and scopes to the caller, so this only maps the raw
// projection into the view shape and never defaults a missing amount to a plausible one.
export async function holdingsFor(party: Party): Promise<LedgerResult<HoldingView[]>> {
  return mapResult(await readHoldingsAs(party), (hs) =>
    hs.map((h) => ({
      contractId: h.contractId,
      amountCbtc: num(h.amount),
      instrument: typeof h.instrument === 'string' ? h.instrument : 'unknown',
    })),
  )
}

// Map one EpochReport payload to its view. Exported so the mapping is unit-testable
// against a captured payload without going through a fetch: the deposit-window bug
// survived its own test because the test and the reader guessed the same payload key,
// agreeing with each other and disagreeing with the ledger.
export function toReportView(payload: Record<string, unknown>): EpochReportView {
  return {
    epochNumber: int(payload.epochNumber),
    settlementPath: settlementPath(payload.settlementPath),
    totalPremiumUsdc: num(payload.totalPremiumUsdc),
    totalNotionalCbtc: num(payload.totalNotionalCbtc),
    depositorCount: int(payload.depositorCount),
    collateralReturned: payload.collateralReturned === true,
    observedPrice: optNum(payload.observedPrice),
    strikeUsdcPerCbtc: optNum(payload.strikeUsdcPerCbtc),
  }
}

export async function reportsFor(party: Party): Promise<LedgerResult<EpochReportView[]>> {
  return mapResult(await readAs(party, 'reports'), (cs) =>
    cs.map((c: LedgerContract) => toReportView(c.payload)),
  )
}
