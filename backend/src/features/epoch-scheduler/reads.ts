// The one I/O step of a scheduler tick: query the operator's ACS across the ten
// templates the lifecycle touches and assemble a TickReads. Selection of the
// "working epoch" implements design decision 3: if positions linger at an epoch
// below the live vault epoch, this tick targets that leftover epoch (so the snapshot
// yields Roll); otherwise it targets the live epoch. Everything is derived from
// on-ledger state, so a restarted or missed-tick scheduler recomputes the same reads.

import { parseDecimal } from '@/services/decimal'
import type { ActiveContract } from '@/services/ledger-client/parse'
import { parseRealHoldings, REAL_CBTC_HOLDING_TID } from '@/services/ledger-client/real-holdings'
import type { LedgerSession } from '@/services/ledger-client/session'
import type { SchedulerConfig } from './config'
import {
  type HoldingRead,
  type ObsRead,
  parseEpochNumbers,
  parseHoldings,
  parseObservations,
  parseOptions,
  parsePositions,
  parseReceipts,
  parseReports,
  parseSettlements,
  parseVault,
} from './read-parse'

// MockAllocation (module Overwrite.Allocation, the CIP-56 allocation interface's local
// stand-in) has no `owner` field: the locked collateral's owner-equivalent is `sender`
// (transferLeg.sender). parseHoldings reads `owner`, so the allocation ACS needs its own
// tiny parse rather than reusing parseHoldings.
interface AllocationRead {
  cid: string
  sender: string
  instrument: string
  amount: string
}

const allocStr = (v: unknown): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''

function parseAllocations(cs: ActiveContract[]): AllocationRead[] {
  return cs.map((c) => ({
    cid: c.contractId,
    sender: allocStr(c.payload.sender),
    instrument: allocStr(c.payload.instrument),
    amount: allocStr(c.payload.amount),
  }))
}

export interface TickReads {
  now: number
  vaultCid: string
  vaultEpoch: number
  windowState: string
  workingEpoch: number
  isLeftover: boolean
  positions: ReturnType<typeof parsePositions>
  optionCid?: string
  optionState?: string
  optionExpiryMs?: number
  optionPremiumUsdc?: string
  optionNotionalCbtc?: string
  optionStrike?: string
  optionMmBuyer?: string
  allocationPresent: boolean
  allocationCid?: string
  allocationAmount?: string
  cashAllocCid?: string
  receiptCids: string[]
  receiptDepositors: string[]
  receiptTotalUsdc: number
  settlementCid?: string
  settlementPath?: 'OTM' | 'ITM'
  settlementCollateralReturned?: boolean
  reportPresent: boolean
  reportSettlementPath?: 'OTM' | 'ITM'
  reportCollateralReturned?: boolean
  latestPrice?: string
  settleObsCid?: string
  settleObsPrice?: string
  poolHoldingCid?: string
  poolAmount?: string
  /** Every operator CBTC holding, largest first. `poolHoldingCid` is its head. */
  poolHoldingCids?: string[]
  premiumHoldingCid?: string
  premiumAmount?: string
  factoryCid?: string
}

function maxAmount(hs: HoldingRead[]): HoldingRead | undefined {
  return hs.reduce<HoldingRead | undefined>(
    (best, h) =>
      best === undefined || parseDecimal(h.amount) > parseDecimal(best.amount) ? h : best,
    undefined,
  )
}

function latestObs(os: ObsRead[]): ObsRead | undefined {
  return os.reduce<ObsRead | undefined>(
    (best, o) => (best === undefined || o.observedAtMs > best.observedAtMs ? o : best),
    undefined,
  )
}

export async function readTick(
  session: LedgerSession,
  cfg: SchedulerConfig,
  now: number = Date.now(),
): Promise<TickReads | null> {
  // One offset for the whole tick. Resolving it per query would let the ten reads
  // below land on ten different offsets and assemble a state the ledger never had
  // (a vault from before a deposit next to the positions from after it). That fails
  // closed on a Daml assert rather than mispaying, but it costs retries, and where a
  // holding is chosen by size it can pick one a fresher offset would have excluded.
  const offset = await session.ledgerEnd()
  const q = (m: string, t: string): Promise<ActiveContract[]> =>
    session.queryAt(offset, cfg.operator, m, t)
  const [
    vaults,
    positionsAcs,
    optionsAcs,
    allocAcs,
    receiptAcs,
    settlementAcs,
    reportAcs,
    obsAcs,
    holdingAcs,
    factoryAcs,
  ] = await Promise.all([
    q('Vault', 'Vault'),
    q('VaultPosition', 'VaultPosition'),
    q('CallOption', 'CallOption'),
    q('Allocation', 'MockAllocation'),
    q('PremiumReceipt', 'PremiumReceipt'),
    q('EpochSettlement', 'EpochSettlement'),
    q('EpochReport', 'EpochReport'),
    q('PriceObservation', 'PriceObservation'),
    q('Allocation', 'Holding'),
    // MockAllocationFactory: the operator is its `user` observer, so an
    // operator-scoped query returns it. There is one, created once by the seed;
    // LockCollateral is nonconsuming on it, so it persists across epochs.
    q('Allocation', 'MockAllocationFactory'),
  ])

  const vaultAc = vaults[0]
  if (vaultAc === undefined) return null
  const vault = parseVault(vaultAc)

  const allPositions = parsePositions(positionsAcs)
  const leftoverEpochs = allPositions.map((p) => p.epochNumber).filter((e) => e < vault.epochNumber)
  const isLeftover = leftoverEpochs.length > 0
  const workingEpoch = isLeftover ? Math.min(...leftoverEpochs) : vault.epochNumber
  const positions = allPositions.filter((p) => p.epochNumber === workingEpoch)

  const option = parseOptions(optionsAcs).find((o) => o.epochNumber === workingEpoch)

  const allocations = parseAllocations(allocAcs)
  const cbtcAlloc = allocations.find((a) => a.instrument === 'CBTC')
  const cashAlloc = allocations.find(
    (a) => a.sender === cfg.mmBuyer && a.instrument === cfg.cashInstrument,
  )

  const receipts = parseReceipts(receiptAcs).filter((r) => r.epochNumber === workingEpoch)
  const settlement = parseSettlements(settlementAcs).find((s) => s.epochNumber === workingEpoch)
  const reportPresent = parseEpochNumbers(reportAcs).includes(workingEpoch)
  const report = parseReports(reportAcs).find((r) => r.epochNumber === workingEpoch)

  const observations = parseObservations(obsAcs)
  const latest = latestObs(observations)
  const settleObs = latestObs(
    observations.filter(
      (o) =>
        o.epochNumber === workingEpoch &&
        option !== undefined &&
        o.observedAtMs >= option.expiryMs &&
        o.observedAtMs <= now,
    ),
  )

  // CBTC pool: real registry holdings in real mode (utility-registry-holding-v0),
  // the local mock Holding otherwise. Premium is always the mock cash instrument
  // (real cash is out of scope), so it keeps reading the local Holding template.
  const cbtcHoldings: HoldingRead[] = cfg.useRealRegistry
    ? parseRealHoldings(
        await session.queryRawAt(offset, cfg.operator, REAL_CBTC_HOLDING_TID),
        cfg.registrar,
      )
    : parseHoldings(holdingAcs)
  // Every operator CBTC holding, largest first, not just the largest one. All of the
  // operator's CBTC is the vault pool (custody is pooled), but it does not arrive as
  // one contract: a deposit made while the window is open lands as its own holding
  // while the vault counts it in totalPooledCbtc, so locking the largest piece alone
  // cannot cover the pool. The lock handler consolidates these before locking.
  const poolPieces = cbtcHoldings
    .filter((h) => h.owner === cfg.operator && h.instrument === 'CBTC')
    .sort((a, b) => parseDecimal(b.amount) - parseDecimal(a.amount))
  const pool = poolPieces[0]
  const premium = maxAmount(
    parseHoldings(holdingAcs).filter(
      (h) => h.owner === cfg.operator && h.instrument === cfg.cashInstrument,
    ),
  )

  return {
    now,
    vaultCid: vault.cid,
    vaultEpoch: vault.epochNumber,
    windowState: vault.windowState,
    workingEpoch,
    isLeftover,
    positions,
    optionCid: option?.cid,
    optionState: option?.state,
    optionExpiryMs: option?.expiryMs,
    optionPremiumUsdc: option?.premiumUsdc,
    optionNotionalCbtc: option?.notionalCbtc,
    optionStrike: option?.strike,
    optionMmBuyer: option?.mmBuyer,
    allocationPresent: cbtcAlloc !== undefined,
    allocationCid: cbtcAlloc?.cid,
    allocationAmount: cbtcAlloc?.amount,
    cashAllocCid: cashAlloc?.cid,
    receiptCids: receipts.map((r) => r.cid),
    receiptDepositors: receipts.map((r) => r.depositor),
    receiptTotalUsdc: receipts.reduce((a, r) => a + parseDecimal(r.premiumPaidUsdc), 0),
    settlementCid: settlement?.cid,
    settlementPath: settlement?.settlementPath as 'OTM' | 'ITM' | undefined,
    settlementCollateralReturned: settlement?.collateralReturned,
    reportPresent,
    reportSettlementPath: report?.settlementPath as 'OTM' | 'ITM' | undefined,
    reportCollateralReturned: report?.collateralReturned,
    latestPrice: latest?.price,
    settleObsCid: settleObs?.cid,
    settleObsPrice: settleObs?.price,
    poolHoldingCid: pool?.cid,
    poolAmount: pool?.amount,
    poolHoldingCids: poolPieces.map((h) => h.cid),
    premiumHoldingCid: premium?.cid,
    premiumAmount: premium?.amount,
    factoryCid: factoryAcs[0]?.contractId,
  }
}
