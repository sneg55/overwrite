// Settle / record / roll handlers (operator authority). Settlement path is chosen
// from the oracle observation (by cid) versus the option strike, so no off-ledger
// number decides money. RecordEpoch also advances the vault to N+1 (design decision
// 3), so rollover is a SEPARATE reconciliation: the next tick sees leftover positions
// and dispatches roll. Everything derives from reads, so a repeated call is safe.
//
// RecordEpoch and RollPositions are batch choices on the CURRENT vault: the ledger
// derives the depositor list and the premium/notional totals from the position and
// receipt cids handed in (RecordEpoch), and runs the whole per-position close-out
// on-ledger (RollPositions). The handler passes the settlement record cid, never a
// pre-computed aggregate or operator-derived settlement fact.

import { parseDecimal } from '@/services/decimal'
import { cmdId } from '@/services/ledger-client/session'
import type { DisclosedContract } from '@/services/registry-client/types'
import { type ChoiceExtraArgs, toExtraArgs } from '@/services/registry-client/types'
import { type HandlerCtx, liveRegistry } from './handlers'

export async function settle(ctx: HandlerCtx): Promise<void> {
  const { reads, cfg, session } = ctx
  if (reads.optionCid === undefined) return // already settled (option archived)
  const obsCid = reads.settleObsCid
  const price = reads.settleObsPrice
  const strike = reads.optionStrike
  if (obsCid === undefined || price === undefined || strike === undefined) {
    // No valid at-or-after-expiry observation yet: wait for the oracle. Not an error.
    return
  }
  const otm = parseDecimal(price) <= parseDecimal(strike)
  // Both settle choices now forward a registry choice context per allocation leg.
  // The collateral leg is the one that can be a real registry allocation; the cash
  // leg is still mock USDC, which ignores its context (see the honesty note in
  // the README). Contexts are fetched immediately before the
  // submission, never cached across ticks: the registry expires them.
  const collateralAllocCid = reads.allocationCid
  if (otm) {
    // OTM withdraws the collateral back to the vault, so the context is keyed to the
    // registry's `withdraw` choice, not `execute-transfer`.
    const cbtcContext = await legContext(ctx, collateralAllocCid, 'withdraw')
    await session.exercise({
      module: 'CallOption',
      template: 'CallOption',
      contractId: reads.optionCid,
      choice: 'SettleOTM',
      choiceArgument: { obsCid, cbtcContext: cbtcContext.extraArgs },
      actAs: [cfg.operator],
      commandId: cmdId('settle-otm'),
      disclosed: cbtcContext.disclosed,
    })
    return
  }
  const cashAllocationCid = reads.cashAllocCid
  if (cashAllocationCid === undefined) {
    // ITM but the MM has not allocated its strike cash yet: wait for the MM process.
    return
  }
  // ITM executes the collateral transfer to the buyer. The cash leg is mock USDC,
  // which ignores its context; when a real cash instrument arrives it fetches its
  // own context here without a Daml signature change.
  const cbtcContext = await legContext(ctx, collateralAllocCid, 'execute-transfer')
  await session.exercise({
    module: 'CallOption',
    template: 'CallOption',
    contractId: reads.optionCid,
    choice: 'SettleITM',
    choiceArgument: {
      obsCid,
      cashAllocationCid,
      cbtcContext: cbtcContext.extraArgs,
      cashContext: emptyExtraArgs.extraArgs,
    },
    actAs: [cfg.operator],
    commandId: cmdId('settle-itm'),
    disclosed: cbtcContext.disclosed,
  })
}

interface LegContext {
  extraArgs: ChoiceExtraArgs
  disclosed?: DisclosedContract[]
}

// The context the local MockAllocation ignores, and what the cash leg passes until a
// real cash instrument exists.
const emptyExtraArgs: LegContext = {
  extraArgs: { context: { values: {} }, meta: { values: {} } },
}

// Fetch the registry's choice context for one allocation leg. `choice` matters: the
// registry issues a different context for `withdraw` (OTM) than for
// `execute-transfer` (ITM). Fetched immediately before the submission because the
// registry expires these; never cached across ticks.
async function legContext(
  ctx: HandlerCtx,
  allocationCid: string | undefined,
  choice: 'execute-transfer' | 'withdraw',
): Promise<LegContext> {
  if (!ctx.cfg.useRealRegistry || allocationCid === undefined) return emptyExtraArgs
  const fetched = await (ctx.registry ?? liveRegistry).allocationContext(
    ctx.cfg.registryUrl,
    ctx.cfg.registrar,
    allocationCid,
    choice,
    new AbortController().signal,
  )
  return { extraArgs: toExtraArgs(fetched), disclosed: fetched.disclosedContracts }
}

export async function recordEpoch(ctx: HandlerCtx): Promise<void> {
  const { reads, cfg, session } = ctx
  const settlementCid = reads.settlementCid
  if (settlementCid === undefined) return
  const positionCids = reads.positions.map((p) => p.cid)
  await session.exercise({
    module: 'Vault',
    template: 'Vault',
    contractId: reads.vaultCid,
    choice: 'RecordEpoch',
    choiceArgument: {
      positionCids,
      receiptCids: reads.receiptCids,
      settlementCid,
    },
    actAs: [cfg.operator],
    commandId: cmdId('record'),
  })
}

export async function roll(ctx: HandlerCtx): Promise<void> {
  const { reads, cfg, session } = ctx
  // The whole per-position close-out runs on-ledger via one RollPositions choice on the
  // current vault. It branches on the settlement path: OTM pays and rolls (needs the
  // recovered CBTC pool), ITM closes and distributes (needs the strike-cash proceeds).
  // Optional a encodes as the value or null on the JSON Ledger API.
  const positionCids = reads.positions.map((p) => p.cid)
  const settlementCid = reads.settlementCid
  const settlementPath = reads.settlementPath
  if (settlementCid === undefined || settlementPath === undefined) return
  const poolCid = settlementPath === 'OTM' ? (reads.poolHoldingCid ?? null) : null
  const proceedsCid = settlementPath === 'ITM' ? (reads.premiumHoldingCid ?? null) : null
  await session.exercise({
    module: 'Vault',
    template: 'Vault',
    contractId: reads.vaultCid,
    choice: 'RollPositions',
    choiceArgument: { positionCids, settlementCid, poolCid, proceedsCid },
    actAs: [cfg.operator],
    commandId: cmdId('roll'),
  })
}
