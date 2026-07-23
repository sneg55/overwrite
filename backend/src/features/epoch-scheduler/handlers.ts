// Ledger-backed lifecycle handlers (operator authority). Each takes the current tick
// reads so it is a pure function of observed on-ledger state (idempotent: a repeated
// call recomputes from what the ledger shows). WriteCall derives the strike-setting
// spot from the latest on-ledger PriceObservation (the oracle's work), and premium as
// a labeled demo parameter (notional * spot * bps). Settlement price is NOT read here;
// it is read by the settle handler from an oracle observation by cid.

import { createHash } from 'node:crypto'
import { AppError, ErrorIds } from '@/constants/errorIds'
import { parseDecimal, splitPremium, toDecimal } from '@/services/decimal'
import { cmdId, type LedgerSession } from '@/services/ledger-client/session'
import { createdOf } from '@/services/ledger-client/tx'
import {
  fetchAllocationChoiceContext,
  fetchAllocationFactoryChoiceContext,
} from '@/services/registry-client/client'
import type { DisclosedContract } from '@/services/registry-client/types'
import { type ChoiceExtraArgs, toExtraArgs } from '@/services/registry-client/types'
import type { SchedulerConfig } from './config'
import type { TickReads } from './reads'

// The registry calls the handlers make, as an injectable seam. Defaults to the real
// registry client; tests pass stubs, the same way `session` is already injected. Only
// reached when cfg.useRealRegistry is true.
export interface RegistryPort {
  factoryContext: typeof fetchAllocationFactoryChoiceContext
  allocationContext: typeof fetchAllocationChoiceContext
}

export const liveRegistry: RegistryPort = {
  factoryContext: fetchAllocationFactoryChoiceContext,
  allocationContext: fetchAllocationChoiceContext,
}

export interface HandlerCtx {
  session: LedgerSession
  reads: TickReads
  cfg: SchedulerConfig
  registry?: RegistryPort
}

export async function openDeposits(ctx: HandlerCtx): Promise<void> {
  await ctx.session.exercise({
    module: 'Vault',
    template: 'Vault',
    contractId: ctx.reads.vaultCid,
    choice: 'OpenDeposits',
    choiceArgument: {},
    actAs: [ctx.cfg.operator],
    commandId: cmdId('open'),
  })
}

export async function writeCall(ctx: HandlerCtx): Promise<void> {
  const { reads, cfg } = ctx
  const spot = reads.latestPrice
  if (spot === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_PRICE,
      `${ErrorIds.SCHED_NO_PRICE}: write: no PriceObservation yet for spotAtOpen`,
    )
  }
  const notional = reads.allocationAmount
  const allocCid = reads.allocationCid
  if (notional === undefined || allocCid === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_ALLOCATION,
      `${ErrorIds.SCHED_NO_ALLOCATION}: write: no CBTC allocation to write against`,
    )
  }
  const premium = toDecimal(parseDecimal(notional) * parseDecimal(spot) * (cfg.premiumBps / 10_000))
  const expiry = new Date(reads.now + cfg.epochLengthMs).toISOString()
  await ctx.session.exercise({
    module: 'Vault',
    template: 'Vault',
    contractId: reads.vaultCid,
    choice: 'WriteCall',
    choiceArgument: {
      mmBuyer: cfg.mmBuyer,
      collateralAllocationCid: allocCid,
      spotAtOpen: spot,
      premiumUsdc: premium,
      notionalCbtc: notional,
      expiry,
    },
    actAs: [cfg.operator, cfg.mmBuyer],
    // Deterministic, unlike the other lifecycle command ids, because WriteCall is the
    // only NONCONSUMING lifecycle choice: a duplicate submission creates a second
    // CallOption against the same collateral rather than failing on an archived
    // contract. The MM pays premium per visible option, so a retry after a lost
    // response makes the buyer pay twice for one lot of collateral, and the extra
    // option then keeps the vault from ever reading as settled. A stable id makes the
    // ledger dedup the retry instead. Matches the fan-out ids below.
    commandId: `epoch-${reads.workingEpoch}-write`,
  })
}

// Keyed on the POSITION, not the depositor. A depositor can hold more than one
// position in an epoch (deposit into an epoch that already holds a rolled position),
// and two commands submitted under one id are deduplicated by the ledger, so a
// depositor-keyed id silently dropped the second payout.
function positionCommandId(positionCid: string): string {
  return createHash('sha256').update(positionCid).digest('hex').slice(0, 16)
}

export async function distributePremium(ctx: HandlerCtx): Promise<void> {
  const { reads, cfg, session } = ctx
  const base = reads.optionPremiumUsdc
  if (base === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_ALLOCATION,
      `${ErrorIds.SCHED_NO_ALLOCATION}: distribute: option premium unknown`,
    )
  }
  const running = reads.premiumHoldingCid
  if (running === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_PREMIUM_HOLDING,
      `${ErrorIds.SCHED_NO_PREMIUM_HOLDING}: distribute: no received premium holding`,
    )
  }
  // Pin the order. Both the premium split (which position takes the rounding dust)
  // and the resume rule below read positions positionally, and ACS order is not
  // guaranteed stable between ticks, so an unsorted list makes a resumed fan-out mean
  // something different from the one it is resuming.
  const positions = [...reads.positions].sort((a, b) => a.cid.localeCompare(b.cid))
  const amounts = splitPremium(
    base,
    positions.map((p) => p.principalCbtc),
  )
  // How many of each depositor's positions are already paid. A PremiumReceipt names
  // its depositor but not its position, so this count is the only available signal for
  // how many of that depositor's positions are still owed. This used to be a set
  // membership test, which paid a depositor holding two positions exactly once: the
  // receipt count then never reached the position count, so the snapshot never read as
  // distributed and the scheduler re-dispatched the fan-out on every tick, forever.
  const alreadyPaid = new Map<string, number>()
  for (const depositor of reads.receiptDepositors) {
    alreadyPaid.set(depositor, (alreadyPaid.get(depositor) ?? 0) + 1)
  }
  const unpaid: { pos: (typeof positions)[number]; amt: string }[] = []
  positions.forEach((pos, i) => {
    const outstanding = alreadyPaid.get(pos.depositor) ?? 0
    if (outstanding > 0) {
      alreadyPaid.set(pos.depositor, outstanding - 1)
      return
    }
    unpaid.push({ pos, amt: amounts[i] ?? toDecimal(0) })
  })
  // Full recovery after Split commits but before PayoutPremium requires an atomic
  // split-and-pay change to the Daml PayoutPremium choice. That follow-up is out of
  // scope; this handler otherwise fails loudly and safely rather than mispaying.
  let runningCid = running

  for (let i = 0; i < unpaid.length; i++) {
    const entry = unpaid[i]
    if (entry === undefined) continue
    const isLast = i === unpaid.length - 1
    const positionId = positionCommandId(entry.pos.cid)
    let usdcCid = runningCid
    if (!isLast) {
      const split = await session.exercise({
        module: 'Allocation',
        template: 'Holding',
        contractId: runningCid,
        choice: 'Split',
        choiceArgument: { splitAmount: entry.amt },
        actAs: [cfg.operator],
        commandId: `epoch-${reads.workingEpoch}-split-${positionId}`,
      })
      const created = createdOf(split, 'Allocation', 'Holding')
      const first = created[0]?.contractId
      const remainder = created[1]?.contractId
      if (first === undefined || remainder === undefined) {
        throw new AppError(
          ErrorIds.SCHED_NO_PREMIUM_HOLDING,
          `${ErrorIds.SCHED_NO_PREMIUM_HOLDING}: distribute: split produced no holdings`,
        )
      }
      usdcCid = first
      runningCid = remainder
    }
    await session.exercise({
      module: 'VaultPosition',
      template: 'VaultPosition',
      contractId: entry.pos.cid,
      choice: 'PayoutPremium',
      choiceArgument: {
        premiumUsdc: entry.amt,
        usdcCid,
        transferRef: `epoch-${reads.workingEpoch}-${entry.pos.depositor}-${positionId}`,
      },
      actAs: [cfg.operator],
      commandId: `epoch-${reads.workingEpoch}-payout-${positionId}`,
    })
  }
}
