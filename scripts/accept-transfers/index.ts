#!/usr/bin/env bun
// Accept pending CBTC transfer offers so a funded party actually holds spendable CBTC.
//
// A faucet transfer is two-step: the faucet submits a TransferOffer, and the RECEIVER
// must exercise TransferInstruction_Accept to turn it into an unlocked Holding they own.
// Until then the receiver only OBSERVES the sender's locked holding and cannot deposit.
// `fund-parties` does the first step; this does the second. Recipe proven live
// 2026-07-13, see docs/spikes/0.1-allocation-cycle.md "Accept recipe".
//
// Usage (from repo root, with PATH including ~/.bun/bin):
//   bun scripts/accept-transfers <party...>            # dry-run: list offers, no submit
//   bun scripts/accept-transfers <party...> --execute  # accept them (VALUE-MATERIALISING)
//
// Each <party> is a full `hint::namespace` id whose bearer our OIDC user can act as.
// Reads config from repo .env directly (standalone tool, does not boot the env boundary).

import { keycloakPasswordGrant } from '../../backend/src/services/ledger-client/auth'
import {
  getLedgerEnd,
  queryActiveContracts,
  submitAndWait,
} from '../../backend/src/services/ledger-client/client'
import { acsFilter, exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import {
  type ActiveContract,
  parseActiveContracts,
} from '../../backend/src/services/ledger-client/parse'
import type { LedgerConfig } from '../../backend/src/services/ledger-client/types'
import { fetchAcceptChoiceContext } from '../../backend/src/services/registry-client/client'
import { toExtraArgs } from '../../backend/src/services/registry-client/types'

// The token-standard TransferInstruction interface. A registry TransferOffer implements
// it, so the offer cid is exercised through this interface id, not the concrete template.
const TRANSFER_INSTRUCTION_IID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'
// The concrete registry template we scope the ACS read to. Package-name reference form,
// so it resolves against whatever version is vetted on the participant.
const TRANSFER_OFFER_TID =
  '#utility-registry-app-v0:Utility.Registry.App.V0.Model.Transfer:TransferOffer'
const TIMEOUT_MS = 45_000

// Everything a ledger call needs, bundled so the per-offer helpers stay under the
// parameter limit. Built once in main from .env.
interface Ctx {
  ledger: LedgerConfig
  token: string
  registryUrl: string
  registrar: string
}

async function readEnv(): Promise<Record<string, string>> {
  const raw = await Bun.file(`${import.meta.dir}/../../.env`).text()
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m?.[1] === undefined) continue
    out[m[1]] = (m[2] ?? '').replace(/^["'](.*)["']$/, '$1')
  }
  return out
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

// Ledger scalar fields (party ids, decimal amounts) arrive as strings; coerce through a
// narrow so a malformed non-string is dropped rather than stringified to [object Object].
function asStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

interface PendingOffer {
  contractId: string
  amount: string
}

// TransferOffers where `party` is the receiver. The ACS read is already template- and
// party-scoped, so this reads the amount and belt-and-suspenders re-checks the receiver.
function pendingOffersFor(contracts: ActiveContract[], party: string): PendingOffer[] {
  const out: PendingOffer[] = []
  for (const c of contracts) {
    const transfer = asRecord(c.payload.transfer)
    if (asStr(transfer.receiver) !== party) continue
    out.push({ contractId: c.contractId, amount: asStr(transfer.amount) || '?' })
  }
  return out
}

async function offersFor(ctx: Ctx, party: string): Promise<PendingOffer[]> {
  const activeAtOffset = await getLedgerEnd(ctx.ledger, ctx.token)
  const raw = await queryActiveContracts(
    ctx.ledger,
    ctx.token,
    acsFilter({ party, templateId: TRANSFER_OFFER_TID, activeAtOffset }),
  )
  return pendingOffersFor(parseActiveContracts(raw), party)
}

async function acceptOffer(ctx: Ctx, party: string, offer: PendingOffer): Promise<number> {
  const context = await fetchAcceptChoiceContext(
    ctx.registryUrl,
    ctx.registrar,
    offer.contractId,
    AbortSignal.timeout(TIMEOUT_MS),
  )
  const body = exerciseCommand({
    templateId: TRANSFER_INSTRUCTION_IID,
    contractId: offer.contractId,
    choice: 'TransferInstruction_Accept',
    choiceArgument: { extraArgs: toExtraArgs(context) },
    actAs: [party],
    commandId: `accept-${offer.contractId.slice(0, 16)}`,
    disclosed: context.disclosedContracts,
  })
  await submitAndWait(ctx.ledger, ctx.token, body)
  return context.disclosedContracts.length
}

async function processParty(ctx: Ctx, party: string, execute: boolean): Promise<void> {
  const short = party.split('::')[0]
  const offers = await offersFor(ctx, party)
  if (offers.length === 0) {
    console.log(`  ${short}: no pending offers`)
    return
  }
  for (const offer of offers) {
    const tag = `${offer.contractId.slice(0, 20)}... amount ${offer.amount}`
    if (!execute) {
      console.log(`  ${short}: offer ${tag} (would accept)`)
      continue
    }
    const disclosed = await acceptOffer(ctx, party, offer)
    console.log(`  ${short}: accepted ${tag} (${disclosed} disclosed)`)
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const execute = argv.includes('--execute')
  const parties = argv.filter((a) => !a.startsWith('--'))
  if (parties.length === 0) {
    console.error('usage: bun scripts/accept-transfers <party...> [--execute]')
    process.exit(1)
  }

  const env = await readEnv()
  const registryUrl = env.REGISTRY_URL ?? ''
  const registrar = env.CBTC_NETWORK_PARTY ?? ''
  if (registryUrl === '' || registrar === '')
    throw new Error('REGISTRY_URL / CBTC_NETWORK_PARTY missing from .env')

  const { access_token: token } = await keycloakPasswordGrant({
    tokenUrl: env.OIDC_TOKEN_URL ?? '',
    clientId: env.OIDC_CLIENT_ID ?? '',
    scope: env.OIDC_SCOPE ?? 'openid daml_ledger_api',
    username: env.OIDC_USERNAME ?? '',
    password: env.OIDC_PASSWORD ?? '',
  })

  const ctx: Ctx = { ledger: { baseUrl: env.LEDGER_API_URL ?? '' }, token, registryUrl, registrar }

  console.log(
    execute
      ? '[EXECUTE] accepting transfer offers'
      : '[DRY-RUN] listing pending offers (pass --execute to accept)',
  )
  for (const party of parties) await processParty(ctx, party, execute)
}

main().catch((e) => {
  console.error('FAILED:', e instanceof Error ? e.message : String(e))
  process.exit(1)
})
