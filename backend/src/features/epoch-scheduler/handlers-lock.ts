// Lock handler (operator authority): consolidate the operator's CBTC pool, then
// allocate it as collateral for the epoch's call.
//
// Split from handlers.ts under the file-size rule, the same way the settle/record/roll
// handlers were, and for the same reason: the lock path carries the registry
// choice-context fetch, which is the largest single concern in that file.
//
// LockCollateral takes the settlement window as CHOICE ARGUMENTS rather than letting
// Daml pick it with getTime, because the registry's off-ledger choice context is
// fetched for the exact arguments the submission carries. Daml still bounds them (see
// assertValidAllocationWindow) and still builds the allocation spec itself, so the
// caller controls when, never where.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { cmdId } from '@/services/ledger-client/session'
import { createdOf } from '@/services/ledger-client/tx'
import type { DisclosedContract } from '@/services/registry-client/types'
import { type ChoiceExtraArgs, toExtraArgs } from '@/services/registry-client/types'
import { type HandlerCtx, liveRegistry } from './handlers'

/**
 * Fold the operator's CBTC holdings into one and return it.
 *
 * All of the operator's CBTC is the vault pool (custody is pooled), but it is not
 * always one contract: a deposit made while the deposit window is open arrives as its
 * own holding while the vault counts it in totalPooledCbtc. Locking the largest single
 * piece then cannot cover the pool, Daml rejects the choice, and because the scheduler
 * recomputes the same state every tick it rejects it forever, so the vault stops
 * rolling for good. Consolidating first is what the seeds already do when they build
 * the pool, and what the 10-UTXO soft limit calls for anyway.
 *
 * Real mode is deliberately left alone: registry holdings are CIP-56 contracts, not
 * this local template, so this Merge does not apply to them and the registry has its
 * own consolidation path. The devnet lock proof ran with unrelated dust holdings
 * beside the pool and worked, because picking the largest is correct there.
 */
async function consolidatePool(ctx: HandlerCtx): Promise<string | undefined> {
  const pieces = ctx.reads.poolHoldingCids ?? []
  if (ctx.cfg.useRealRegistry || pieces.length < 2) return ctx.reads.poolHoldingCid

  let merged = pieces[0]
  for (let i = 1; i < pieces.length; i++) {
    const tx = await ctx.session.exercise({
      module: 'Allocation',
      template: 'Holding',
      contractId: merged as string,
      choice: 'Merge',
      choiceArgument: { otherCid: pieces[i] },
      actAs: [ctx.cfg.operator],
      // Merge is consuming, so a genuine replay fails on the archived contract. This
      // id covers the other case, a retry after a lost response, which a consuming
      // choice cannot self-heal. Same reasoning as the WriteCall command id.
      commandId: `epoch-${ctx.reads.workingEpoch}-pool-merge-${i}`,
    })
    merged = createdOf(tx, 'Allocation', 'Holding')[0]?.contractId
    if (merged === undefined) {
      throw new AppError(
        ErrorIds.SCHED_POOL_MERGE_EMPTY,
        `${ErrorIds.SCHED_POOL_MERGE_EMPTY}: lock: consolidating the CBTC pool produced no holding`,
      )
    }
  }
  return merged
}

export async function lockCollateral(ctx: HandlerCtx): Promise<void> {
  const pool = await consolidatePool(ctx)
  if (pool === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_POOL,
      `${ErrorIds.SCHED_NO_POOL}: lock: no operator CBTC pool holding to allocate`,
    )
  }
  const requestedAtMs = ctx.reads.now
  const allocateBeforeMs = requestedAtMs + ctx.cfg.allocateWindowMs
  // settleBefore must outlast the option this collateral backs. The option's expiry
  // is set later, at WriteCall, as writeTime + epochLengthMs, so the epoch length has
  // to be folded in here: with a weekly epoch and a 24h allocate window, deriving
  // settleBefore from the allocate window alone would close the settlement window
  // about six days BEFORE expiry. The collateral would then be withdrawable while the
  // call is still live, leaving the buyer holding an option that cannot be delivered
  // against and a premium it cannot recover. Nothing on-ledger catches this: the Daml
  // guard only relates settleBefore to allocateBefore, and the local mock allocation
  // ignores both windows, so the Daml suite cannot see it either.
  const settleBeforeMs = allocateBeforeMs + ctx.cfg.epochLengthMs + ctx.cfg.settleBufferMs
  const window = {
    requestedAt: new Date(requestedAtMs).toISOString(),
    allocateBefore: new Date(allocateBeforeMs).toISOString(),
    settleBefore: new Date(settleBeforeMs).toISOString(),
  }

  const registry = ctx.cfg.useRealRegistry ? await fetchLockContext(ctx, pool, window) : undefined

  // The factory cid comes from the fetched choice context in real mode, or the local
  // MockAllocationFactory (mock mode only; devnet has none) read off the ledger.
  const factoryCid = registry?.factoryId ?? ctx.reads.factoryCid
  if (factoryCid === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_ALLOCATION,
      `${ErrorIds.SCHED_NO_ALLOCATION}: lock: no AllocationFactory on the ledger`,
    )
  }

  await ctx.session.exercise({
    module: 'Vault',
    template: 'Vault',
    contractId: ctx.reads.vaultCid,
    // Real mode locks the operator's real registry holding, which arrives as the CIP-56
    // Holding interface type, so it exercises LockCollateralReal. Mock mode keeps
    // LockCollateral (local Holding). The choice arguments are identical; only the pool's
    // on-ledger type differs, and the JSON API passes the cid as a string either way.
    choice: ctx.cfg.useRealRegistry ? 'LockCollateralReal' : 'LockCollateral',
    choiceArgument: {
      cbtcPoolCid: pool,
      mmBuyer: ctx.cfg.mmBuyer,
      factoryCid: registry?.factoryId ?? factoryCid,
      allocContext: registry?.extraArgs ?? emptyExtraArgs(),
      ...window,
    },
    actAs: [ctx.cfg.operator],
    commandId: cmdId('lock'),
    disclosed: registry?.disclosed,
  })
}

// The empty choice context the local MockAllocationFactory ignores. Registry mode
// replaces this with the context fetched for the specific submission.
function emptyExtraArgs(): ChoiceExtraArgs {
  return { context: { values: {} }, meta: { values: {} } }
}

// Mirror the AllocationFactory_Allocate arguments that Daml's LockCollateral will
// submit, so the registry hands back a context valid for exactly that exercise.
//
// This duplicates the shape of `collateralSpec` (daml/src/Overwrite/Allocation.daml)
// on purpose: Daml keeps building the authoritative spec, and this copy exists only
// to fetch the matching context. If the two ever drift, the registry's context will
// not match the submission and the exercise fails closed, which is the intended
// failure mode. Shape proven live against the CBTC devnet registry by
// scripts/devnet-lock (see docs/spikes/0.1-allocation-cycle.md).
async function fetchLockContext(
  ctx: HandlerCtx,
  poolCid: string,
  window: { requestedAt: string; allocateBefore: string; settleBefore: string },
): Promise<{ factoryId: string; extraArgs: ChoiceExtraArgs; disclosed: DisclosedContract[] }> {
  const amount = ctx.reads.poolAmount
  if (amount === undefined) {
    throw new AppError(
      ErrorIds.SCHED_NO_POOL,
      `${ErrorIds.SCHED_NO_POOL}: lock: pool holding has no readable amount`,
    )
  }
  const { operator, mmBuyer, registrar } = ctx.cfg
  const choiceArguments = {
    expectedAdmin: registrar,
    allocation: {
      settlement: {
        executor: operator,
        settlementRef: { id: 'overwrite-collateral', cid: null },
        requestedAt: window.requestedAt,
        allocateBefore: window.allocateBefore,
        settleBefore: window.settleBefore,
        meta: { values: {} },
      },
      transferLegId: 'collateral',
      transferLeg: {
        sender: operator,
        receiver: mmBuyer,
        amount,
        instrumentId: { admin: registrar, id: 'CBTC' },
        meta: { values: {} },
      },
    },
    requestedAt: window.requestedAt,
    inputHoldingCids: [poolCid],
    extraArgs: emptyExtraArgs(),
  }
  const fcc = await (ctx.registry ?? liveRegistry).factoryContext(
    ctx.cfg.registryUrl,
    registrar,
    await ctx.session.token(),
    choiceArguments,
  )
  return { factoryId: fcc.factoryId, extraArgs: toExtraArgs(fcc.context), disclosed: fcc.disclosed }
}
