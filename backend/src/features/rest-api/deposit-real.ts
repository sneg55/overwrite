// Real-CBTC deposit: move then record. The depositor's CBTC has no local Transfer
// choice, so the move is a registry transfer to the operator (one-step, or two-step
// with an operator accept). Once the operator owns it, Vault.RecordDeposit records the
// position. The move is behind a port so the orchestration is unit-testable offline;
// only liveTransferPort talks to devnet.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { getLedgerEnd, queryActiveContracts, submitAndWait } from '@/services/ledger-client/client'
import { acsFilter, exerciseCommand, overwriteTemplateId } from '@/services/ledger-client/commands'
import { parseActiveContracts } from '@/services/ledger-client/parse'
import {
  type HoldingRead,
  parseRealHoldings,
  REAL_CBTC_HOLDING_TID,
} from '@/services/ledger-client/real-holdings'
import type { LedgerConfig } from '@/services/ledger-client/types'
import {
  fetchAcceptChoiceContext,
  fetchTransferFactoryChoiceContext,
} from '@/services/registry-client/client'
import { toExtraArgs } from '@/services/registry-client/types'
import { assertWholeHolding } from './deposit-validation'

export interface TransferPort {
  // Move `holdingCid` (owned by `depositor`) into `operator` custody. Resolves once the
  // operator owns the resulting real CBTC holding. Reacts to the registry result: if the
  // transfer yields a pending TransferInstruction, it accepts it as the operator.
  transferToOperator(args: {
    depositor: string
    operator: string
    holdingCid: string
  }): Promise<void>
}

export interface DepositRealDeps {
  depositor: string
  vaultCid: string
  holdingCid: string
  operator: string
  transfer: TransferPort
  // Exercise Vault.RecordDeposit for the moved holding; returns the ledger response.
  recordDeposit: (movedHoldingCid: string) => Promise<unknown>
  // After the move, resolve the operator-owned real CBTC holding to record. The live
  // implementation (depositRealWhole) matches by amount, which is correct ONLY for a
  // single depositor: with several deposits of the same amount pending it could resolve
  // the wrong holding, so a stronger match key (and exclusion of already-recorded
  // holdings) is part of the multi-depositor follow-on. Returns '' if none matches.
  resolveMovedHolding: () => Promise<string>
}

// Orchestrate a real deposit: move the CBTC into operator custody, then record the
// position against it. depositReal never records unless the move resolved.
//
// Move-then-record is NOT atomic and has NO automatic crash recovery yet. If the process
// dies between the move and the record, the operator holds CBTC with no position, and a
// naive re-run of depositRealWhole fails closed: its first step looks up the DEPOSITOR's
// holding by cid, which is already archived once the move committed, so it throws
// DEP_HOLDING_NOT_FOUND rather than reconciling. Recovering a stranded holding is a
// manual step for now; the reconcile-on-restart path is deferred to the multi-depositor
// follow-on (which is where concurrent pending deposits make it necessary).
export async function depositReal(deps: DepositRealDeps): Promise<unknown> {
  await deps.transfer.transferToOperator({
    depositor: deps.depositor,
    operator: deps.operator,
    holdingCid: deps.holdingCid,
  })
  const moved = await deps.resolveMovedHolding()
  if (moved === '') {
    throw new AppError(
      ErrorIds.DEP_HOLDING_NOT_FOUND,
      'deposit: moved CBTC not found in operator custody after transfer',
      { holdingCid: deps.holdingCid },
    )
  }
  return await deps.recordDeposit(moved)
}

// ── Live devnet transfer port ────────────────────────────────────────────────
// The token-standard TransferFactory (create side) and TransferInstruction (accept
// side) interface ids. Package-name reference form. The factory choice and argument
// shape below are CONFIRMED live by the Phase 0 spike (scripts/devnet-transfer,
// 2026-07-21): TransferFactory_Transfer is TWO-STEP, creating a TransferOffer plus a
// locked holding for the receiver, which the operator then accepts (acceptPendingOffers)
// to unlock. Reached only when USE_REAL_REGISTRY is set, so it cannot run in mock/local.
const TRANSFER_FACTORY_IID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory'
const TRANSFER_INSTRUCTION_IID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'
// The concrete registry offer template a two-step transfer produces (as in
// scripts/accept-transfers).
const TRANSFER_OFFER_TID =
  '#utility-registry-app-v0:Utility.Registry.App.V0.Model.Transfer:TransferOffer'
const TRANSFER_WINDOW_MS = 24 * 60 * 60 * 1000

export interface TransferCtx {
  ledger: LedgerConfig
  token: () => Promise<string>
  userId?: string
  registryUrl: string
  registrar: string
}

// A party's unlocked real CBTC holdings, via the registry holding template.
async function realHoldingsOf(ctx: TransferCtx, party: string): Promise<HoldingRead[]> {
  const token = await ctx.token()
  const offset = await getLedgerEnd(ctx.ledger, token)
  const acs = parseActiveContracts(
    await queryActiveContracts(
      ctx.ledger,
      token,
      acsFilter({ party, templateId: REAL_CBTC_HOLDING_TID, activeAtOffset: offset }),
    ),
  )
  return parseRealHoldings(acs, ctx.registrar)
}

// Read the depositor's real CBTC holding by cid to learn its amount (the whole-holding
// deposit moves exactly that amount).
async function holdingAmount(ctx: TransferCtx, party: string, holdingCid: string): Promise<string> {
  const found = (await realHoldingsOf(ctx, party)).find((h) => h.cid === holdingCid)
  if (found === undefined) {
    throw new AppError(
      ErrorIds.DEP_HOLDING_NOT_FOUND,
      'transfer: CBTC holding not found for depositor',
      {
        holdingCid,
      },
    )
  }
  return found.amount
}

// Accept this depositor's pending CBTC transfer offer to the operator (the two-step
// case). A one-step transfer leaves no offer, so this is a no-op then. Only offers whose
// SENDER is this depositor are accepted: on a shared devnet party the operator can hold
// unrelated incoming offers from other senders, and accepting those would pull in
// third-party value and, worse, fail the whole deposit if any is un-acceptable (e.g. an
// offer past its executeBefore deadline rejects with deadline-exceeded).
async function acceptPendingOffers(
  ctx: TransferCtx,
  operator: string,
  depositor: string,
): Promise<void> {
  const token = await ctx.token()
  const offset = await getLedgerEnd(ctx.ledger, token)
  const acs = parseActiveContracts(
    await queryActiveContracts(
      ctx.ledger,
      token,
      acsFilter({ party: operator, templateId: TRANSFER_OFFER_TID, activeAtOffset: offset }),
    ),
  )
  for (const offer of acs) {
    const tr = offer.payload.transfer as { receiver?: unknown; sender?: unknown } | undefined
    // `tr.sender` is not optional-chained: reaching the right operand means
    // `tr?.receiver` matched a party string, so `tr` is present.
    if (tr?.receiver !== operator || tr.sender !== depositor) continue
    const context = await fetchAcceptChoiceContext(
      ctx.registryUrl,
      ctx.registrar,
      offer.contractId,
      AbortSignal.timeout(TRANSFER_WINDOW_MS),
    )
    await submitAndWait(
      ctx.ledger,
      token,
      exerciseCommand({
        templateId: TRANSFER_INSTRUCTION_IID,
        contractId: offer.contractId,
        choice: 'TransferInstruction_Accept',
        choiceArgument: { extraArgs: toExtraArgs(context) },
        actAs: [operator],
        commandId: `accept-${offer.contractId.slice(0, 16)}`,
        userId: ctx.userId,
        disclosed: context.disclosedContracts,
      }),
    )
  }
}

// Devnet transfer port: submit TransferFactory_Transfer as the depositor, then accept the
// pending offer as the operator (the two-step flow the Phase 0 spike confirmed). The
// accept unlocks the receiver holding, which resolveMovedHolding then records.
export function liveTransferPort(ctx: TransferCtx): TransferPort {
  return {
    async transferToOperator({ depositor, operator, holdingCid }): Promise<void> {
      const token = await ctx.token()
      const amount = await holdingAmount(ctx, depositor, holdingCid)
      const now = new Date().toISOString()
      const executeBefore = new Date(Date.now() + TRANSFER_WINDOW_MS).toISOString()
      const choiceArguments = {
        expectedAdmin: ctx.registrar,
        transfer: {
          sender: depositor,
          receiver: operator,
          amount,
          instrumentId: { admin: ctx.registrar, id: 'CBTC' },
          requestedAt: now,
          executeBefore,
          inputHoldingCids: [holdingCid],
          meta: { values: {} },
        },
        extraArgs: { context: { values: {} }, meta: { values: {} } },
      }
      const fcc = await fetchTransferFactoryChoiceContext(
        ctx.registryUrl,
        ctx.registrar,
        token,
        choiceArguments,
      )
      await submitAndWait(
        ctx.ledger,
        token,
        exerciseCommand({
          templateId: TRANSFER_FACTORY_IID,
          contractId: fcc.factoryId,
          choice: 'TransferFactory_Transfer',
          choiceArgument: { ...choiceArguments, extraArgs: toExtraArgs(fcc.context) },
          actAs: [depositor],
          commandId: `xfer-${holdingCid.slice(0, 16)}`,
          userId: ctx.userId,
          disclosed: fcc.disclosed,
        }),
      )
      await acceptPendingOffers(ctx, operator, depositor)
    },
  }
}

// ── Gateway entry point ──────────────────────────────────────────────────────
// The gateway's real-mode deposit lives here (not on the LedgerGateway class) so all
// real-CBTC deposit logic stays in one module.
export interface RealDepositConfig extends TransferCtx {
  operator: string
}

// Exercise Vault.RecordDeposit (operator authority) for a moved real holding.
async function recordDepositCmd(
  cfg: RealDepositConfig,
  depositor: string,
  vaultCid: string,
  movedCid: string,
  topUpPositionCid: string | null,
): Promise<unknown> {
  const token = await cfg.token()
  return await submitAndWait(
    cfg.ledger,
    token,
    exerciseCommand({
      templateId: overwriteTemplateId('Vault', 'Vault'),
      contractId: vaultCid,
      choice: 'RecordDeposit',
      // Fold into the depositor's existing position for this epoch when they have one:
      // a second position makes the epoch unrecordable. Daml-LF JSON encodes
      // Optional as the bare value, or null for None.
      choiceArgument: { depositor, cbtcCid: movedCid, topUpPositionCid },
      actAs: [cfg.operator],
      commandId: `rec-${movedCid.slice(0, 16)}`,
      userId: cfg.userId,
    }),
  )
}

// Real-CBTC deposit (devnet). Whole-holding only: a partial real deposit would need a
// registry split (deferred). Reads the depositor's holding, guards whole-only, then
// move-then-record via depositReal and the live transfer port.
export async function depositRealWhole(
  cfg: RealDepositConfig,
  depositor: string,
  vaultCid: string,
  cbtcCid: string,
  amountCbtc: string,
  topUpPositionCid: string | null = null,
): Promise<unknown> {
  const target = (await realHoldingsOf(cfg, depositor)).find((h) => h.cid === cbtcCid)
  if (target === undefined) {
    throw new AppError(ErrorIds.DEP_HOLDING_NOT_FOUND, 'holding not found, or not owned by you', {
      cbtcCid,
    })
  }
  assertWholeHolding(amountCbtc, target.amount)
  return await depositReal({
    depositor,
    vaultCid,
    holdingCid: cbtcCid,
    operator: cfg.operator,
    transfer: liveTransferPort(cfg),
    recordDeposit: (moved) => recordDepositCmd(cfg, depositor, vaultCid, moved, topUpPositionCid),
    resolveMovedHolding: async () => {
      const held = await realHoldingsOf(cfg, cfg.operator)
      return held.find((h) => Math.abs(Number(h.amount) - Number(target.amount)) <= 1e-9)?.cid ?? ''
    },
  })
}
