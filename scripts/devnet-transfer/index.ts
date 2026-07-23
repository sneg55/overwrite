#!/usr/bin/env bun
// Phase 0 spike: prove the depositor -> operator CBTC transfer-create recipe live, and
// confirm the real-holding read shape. The backend's fetchTransferFactoryChoiceContext /
// liveTransferPort recipe is currently an UNVERIFIED guess modelled on the allocation
// factory; this script is what confirms it (or corrects it).
//
// Modes (from repo root, PATH including ~/.bun/bin):
//   bun run scripts/devnet-transfer/index.ts --inspect    # READ-ONLY: holdings + shape
//   bun run scripts/devnet-transfer/index.ts --dry-run    # probe endpoint + assemble cmd
//   bun run scripts/devnet-transfer/index.ts --execute    # VALUE-MOVING: move 0.01 CBTC
//
// SAFETY: a REJECTED submission moves no value, so iterate the request shape freely on
// --dry-run. --execute moves 0.01 CBTC alice -> operator (reversible via a transfer back).
// The moment it succeeds we STOP, print the created contract(s), and never re-submit.
// Never prints the OIDC token.

import { keycloakPasswordGrant } from '../../backend/src/services/ledger-client/auth'
import {
  getLedgerEnd,
  queryActiveContracts,
  submitAndWait,
} from '../../backend/src/services/ledger-client/client'
import { exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import {
  fetchAcceptChoiceContext,
  fetchTransferFactoryChoiceContext,
} from '../../backend/src/services/registry-client/client'
import { toExtraArgs } from '../../backend/src/services/registry-client/types'

const TRANSFER_FACTORY_IID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory'
const TRANSFER_INSTRUCTION_IID =
  '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction'
const CBTC_HOLDING_TID = 'Utility.Registry.Holding.V0.Holding:Holding'
const MOVE_AMOUNT = '0.01'

interface Cfg {
  baseUrl: string
}

interface Deps {
  registryUrl: string
  registrar: string
  operator: string
  alice: string
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
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

// alice's full party id, parsed out of the SESSIONS map (demo-alice=<party>).
function aliceParty(env: Record<string, string>): string {
  for (const pair of (env.SESSIONS ?? '').split(',')) {
    const [k, v] = pair.split('=')
    if (k?.trim() === 'demo-alice' && v !== undefined) return v.trim()
  }
  throw new Error('demo-alice not found in SESSIONS')
}

interface Holding {
  contractId: string
  amount: string
  locked: boolean
  arg: Record<string, unknown>
}

// The createdEvent of one JsActiveContract entry, narrowed from the ACS response.
function createdEventOf(entry: unknown):
  | {
      templateId?: string
      contractId?: string
      createArgument?: Record<string, unknown>
    }
  | undefined {
  return (
    entry as {
      contractEntry?: {
        JsActiveContract?: {
          createdEvent?: {
            templateId?: string
            contractId?: string
            createArgument?: Record<string, unknown>
          }
        }
      }
    }
  ).contractEntry?.JsActiveContract?.createdEvent
}

// Every CBTC holding on a party's ACS (all-templates query, filtered client-side by the
// holding template id, as scripts/devnet-lock does).
async function cbtcHoldings(cfg: Cfg, token: string, party: string): Promise<Holding[]> {
  const offset = await getLedgerEnd(cfg, token)
  const acs = await queryActiveContracts(cfg, token, {
    verbose: true,
    activeAtOffset: offset,
    filter: { filtersByParty: { [party]: {} } },
  })
  const entries = Array.isArray(acs) ? acs : []
  const out: Holding[] = []
  for (const entry of entries) {
    const ce = createdEventOf(entry)
    if (!ce?.templateId?.includes(CBTC_HOLDING_TID) || ce.contractId === undefined) continue
    const arg = ce.createArgument ?? {}
    out.push({
      contractId: ce.contractId,
      amount: asStr(arg.amount),
      locked: arg.lock !== undefined && arg.lock !== null,
      arg,
    })
  }
  return out
}

function printHoldings(label: string, holdings: Holding[]): void {
  console.log(`\n${label} (${holdings.length}):`)
  for (const h of holdings) console.log(`  ${h.contractId} amount=${h.amount} locked=${h.locked}`)
}

function transferArgs(deps: Deps, holdingCid: string) {
  const now = new Date().toISOString()
  const executeBefore = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  return {
    expectedAdmin: deps.registrar,
    transfer: {
      sender: deps.alice,
      receiver: deps.operator,
      amount: MOVE_AMOUNT,
      instrumentId: { admin: deps.registrar, id: 'CBTC' },
      requestedAt: now,
      executeBefore,
      inputHoldingCids: [holdingCid],
      meta: { values: {} },
    },
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  }
}

function reportCreated(tx: unknown): { pending: boolean } {
  const events =
    (tx as { transaction?: { events?: Record<string, unknown>[] } }).transaction?.events ?? []
  let pending = false
  console.log('\nTRANSFER SUCCEEDED. created contract(s):')
  for (const ev of events) {
    const c = ev.CreatedEvent as { templateId?: string; contractId?: string } | undefined
    if (c?.contractId === undefined) continue
    // Two-step is signalled by a pending TransferInstruction OR a registry TransferOffer
    // (this registry uses the latter, plus a locked receiver holding, per the spike).
    const tid = c.templateId ?? ''
    const isPending = tid.includes('TransferInstruction') || tid.includes('Transfer:TransferOffer')
    if (isPending) pending = true
    console.log(`  [${isPending ? 'PENDING (two-step)' : 'created'}] ${c.contractId}`)
    console.log(`    template=${c.templateId}`)
  }
  return { pending }
}

// Accept every pending CBTC transfer offer addressed to the operator (two-step case).
async function acceptPendingOffers(cfg: Cfg, token: string, deps: Deps): Promise<void> {
  const acs = await queryActiveContracts(cfg, token, {
    verbose: true,
    activeAtOffset: await getLedgerEnd(cfg, token),
    filter: { filtersByParty: { [deps.operator]: {} } },
  })
  for (const entry of Array.isArray(acs) ? acs : []) {
    const ce = createdEventOf(entry)
    if (!ce?.templateId?.includes('Transfer:TransferOffer') || ce.contractId === undefined) continue
    const ctx = await fetchAcceptChoiceContext(
      deps.registryUrl,
      deps.registrar,
      ce.contractId,
      AbortSignal.timeout(45_000),
    )
    await submitAndWait(
      cfg,
      token,
      exerciseCommand({
        templateId: TRANSFER_INSTRUCTION_IID,
        contractId: ce.contractId,
        choice: 'TransferInstruction_Accept',
        choiceArgument: { extraArgs: toExtraArgs(ctx) },
        actAs: [deps.operator],
        commandId: `overwrite-spike-accept-${ce.contractId.slice(0, 12)}`,
        disclosed: ctx.disclosedContracts,
      }),
    )
    console.log(`  accepted offer ${ce.contractId}`)
  }
}

// Submit the transfer, accept a pending instruction if one was produced, then confirm.
async function runExecute(
  cfg: Cfg,
  token: string,
  deps: Deps,
  body: ReturnType<typeof exerciseCommand>,
): Promise<void> {
  console.log('\n[execute] submitting TransferFactory_Transfer (VALUE-MOVING)...')
  const { pending } = reportCreated(await submitAndWait(cfg, token, body))
  if (pending) {
    console.log('\ntwo-step: accepting the pending offer as operator...')
    await acceptPendingOffers(cfg, token, deps)
  }
  console.log(`\nONE-STEP=${!pending}. Re-reading operator holdings to confirm receipt...`)
  printHoldings('operator now holds', await cbtcHoldings(cfg, token, deps.operator))
  console.log(`\nSPIKE RESULT: transfer was ${pending ? 'TWO-STEP (offer + accept)' : 'ONE-STEP'}.`)
}

function modeFromArgv(): 'inspect' | 'dry-run' | 'execute' {
  if (process.argv.includes('--execute')) return 'execute'
  if (process.argv.includes('--dry-run')) return 'dry-run'
  return 'inspect'
}

async function main(): Promise<void> {
  const mode = modeFromArgv()
  const env = await readEnv()
  const cfg: Cfg = { baseUrl: env.LEDGER_API_URL ?? '' }
  const deps: Deps = {
    registryUrl: env.REGISTRY_URL ?? '',
    registrar: env.CBTC_NETWORK_PARTY ?? '',
    operator: env.OPERATOR_PARTY ?? '',
    alice: aliceParty(env),
  }
  console.log(
    `mode=${mode} alice=${deps.alice.split('::')[0]} operator=${deps.operator.split('::')[0]}`,
  )
  const { access_token: token } = await keycloakPasswordGrant({
    tokenUrl: env.OIDC_TOKEN_URL ?? '',
    clientId: env.OIDC_CLIENT_ID ?? '',
    scope: 'openid daml_ledger_api',
    username: env.OIDC_USERNAME ?? '',
    password: env.OIDC_PASSWORD ?? '',
  })

  const aliceHoldings = await cbtcHoldings(cfg, token, deps.alice)
  printHoldings('alice CBTC holdings', aliceHoldings)
  if (aliceHoldings[0] !== undefined) {
    console.log('\nfirst holding createArgument (shape confirmation):')
    console.log(JSON.stringify(aliceHoldings[0].arg, null, 2).slice(0, 1200))
  }
  printHoldings('operator CBTC holdings', await cbtcHoldings(cfg, token, deps.operator))
  if (mode === 'inspect') {
    console.log('\n[inspect] read-only. Re-run with --dry-run to probe the transfer factory.')
    return
  }

  const source = aliceHoldings.find((h) => !h.locked && Number(h.amount) >= Number(MOVE_AMOUNT))
  if (source === undefined) throw new Error(`no unlocked alice CBTC holding >= ${MOVE_AMOUNT}`)
  console.log(
    `\nusing source ${source.contractId} (amount ${source.amount}) to move ${MOVE_AMOUNT}`,
  )

  const args = transferArgs(deps, source.contractId)
  console.log('\nfetching transfer-factory choice context (guessed endpoint)...')
  const fcc = await fetchTransferFactoryChoiceContext(deps.registryUrl, deps.registrar, token, args)
  console.log(`  factoryId=${fcc.factoryId} disclosed=${fcc.disclosed.length}`)
  const body = exerciseCommand({
    templateId: TRANSFER_FACTORY_IID,
    contractId: fcc.factoryId,
    choice: 'TransferFactory_Transfer',
    choiceArgument: { ...args, extraArgs: toExtraArgs(fcc.context) },
    actAs: [deps.alice],
    commandId: `overwrite-spike-xfer-${source.contractId.slice(0, 12)}`,
    disclosed: fcc.disclosed,
  })

  if (mode === 'dry-run') {
    console.log('\n[dry-run] assembled command (NOT submitted):')
    console.log(JSON.stringify(body, null, 2).slice(0, 2000))
    console.log('\nRe-run with --execute to submit (moves 0.01 CBTC).')
    return
  }
  await runExecute(cfg, token, deps, body)
}

main().catch((e) => {
  console.error(`\nDEVNET-TRANSFER FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
