// Pure parsers from ACS payloads to typed reads. The JSON Ledger API serializes Daml
// Int as a string and Time as an ISO string, so epoch numbers are coerced with
// Number(...) and times with Date.parse(...). Amounts stay strings: choice guards
// compare Decimal by value, so an amount passed back into a choice must match the
// on-ledger string's numeric value exactly (see services/decimal.ts).

import type { ActiveContract } from '@/services/ledger-client/parse'

export interface PositionRead {
  cid: string
  depositor: string
  principalCbtc: string
  epochNumber: number
  withdrawQueued: boolean
}

export interface OptionRead {
  cid: string
  state: string
  expiryMs: number
  premiumUsdc: string
  notionalCbtc: string
  strike: string
  mmBuyer: string
  epochNumber: number
}

export interface HoldingRead {
  cid: string
  owner: string
  instrument: string
  amount: string
}

export interface ObsRead {
  cid: string
  epochNumber: number
  price: string
  observedAtMs: number
}

export interface ReceiptRead {
  cid: string
  depositor: string
  epochNumber: number
  premiumPaidUsdc: string
}

export interface SettlementRead {
  cid: string
  epochNumber: number
  settlementPath: string
  collateralReturned: boolean
}

export interface ReportRead {
  epochNumber: number
  settlementPath: string
  collateralReturned: boolean
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
const num = (v: unknown): number => Number(str(v))

export function parseVault(c: ActiveContract): {
  cid: string
  epochNumber: number
  windowState: string
} {
  return {
    cid: c.contractId,
    epochNumber: num(c.payload.epochNumber),
    windowState: str(c.payload.windowState),
  }
}

export function parsePositions(cs: ActiveContract[]): PositionRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    depositor: str(c.payload.depositor),
    principalCbtc: str(c.payload.principalCbtc),
    epochNumber: num(c.payload.epochNumber),
    withdrawQueued: c.payload.withdrawQueued === true,
  }))
}

export function parseOptions(cs: ActiveContract[]): OptionRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    state: str(c.payload.state),
    expiryMs: Date.parse(str(c.payload.expiry)),
    premiumUsdc: str(c.payload.premiumUsdc),
    notionalCbtc: str(c.payload.notionalCbtc),
    strike: str(c.payload.strikeUsdcPerCbtc),
    mmBuyer: str(c.payload.mmBuyer),
    epochNumber: num(c.payload.epochNumber),
  }))
}

export function parseHoldings(cs: ActiveContract[]): HoldingRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    owner: str(c.payload.owner),
    instrument: str(c.payload.instrument),
    amount: str(c.payload.amount),
  }))
}

export function parseObservations(cs: ActiveContract[]): ObsRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    epochNumber: num(c.payload.epochNumber),
    price: str(c.payload.price),
    observedAtMs: Date.parse(str(c.payload.observedAt)),
  }))
}

export function parseReceipts(cs: ActiveContract[]): ReceiptRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    depositor: str(c.payload.depositor),
    epochNumber: num(c.payload.epochNumber),
    premiumPaidUsdc: str(c.payload.premiumPaidUsdc),
  }))
}

export function parseEpochNumbers(cs: ActiveContract[]): number[] {
  return cs.map((c) => num(c.payload.epochNumber))
}

export function parseSettlements(cs: ActiveContract[]): SettlementRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    epochNumber: num(c.payload.epochNumber),
    settlementPath: str(c.payload.settlementPath),
    collateralReturned: c.payload.collateralReturned === true,
  }))
}

export function parseReports(cs: ActiveContract[]): ReportRead[] {
  return cs.map((c) => ({
    epochNumber: num(c.payload.epochNumber),
    settlementPath: str(c.payload.settlementPath),
    collateralReturned: c.payload.collateralReturned === true,
  }))
}
