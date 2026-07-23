#!/usr/bin/env bun
// Live devnet CBTC lock: prove the REAL CIP-56 collateral path end to end. Reads an
// unlocked CBTC holding from our ACS, fetches the registry allocation-factory choice
// context, then exercises `AllocationFactory_Allocate` on the real registry
// AllocationFactory to lock the holding as a self-directed allocation (sender =
// receiver = executor = OPERATOR_PARTY, reversible via withdraw).
//
// SAFETY: a REJECTED submission moves no value, so iterate freely on the request shape.
// A SUCCESSFUL allocate LOCKS the CBTC: the moment it succeeds we STOP, print the
// created cid(s), and never re-submit. Never prints the OIDC token or credentials.
//
// Devnet-only, backend-owned custodial party. Run from the repo root:
//   export PATH="$HOME/.bun/bin:$PATH"; bun run scripts/devnet-lock/index.ts

import { AppError, ErrorIds } from '../../backend/src/constants/errorIds'
import { keycloakPasswordGrant } from '../../backend/src/services/ledger-client/auth'
import {
  getLedgerEnd,
  queryActiveContracts,
  submitAndWait,
} from '../../backend/src/services/ledger-client/client'
import { exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import { fetchAllocationFactoryChoiceContext } from '../../backend/src/services/registry-client/client'
import { toExtraArgs } from '../../backend/src/services/registry-client/types'

// The token-standard AllocationFactory interface id (package-name reference form). The
// JSON Ledger API resolves the interface choice when the templateId is this interface.
const ALLOCATION_FACTORY_IID =
  '#splice-api-token-allocation-instruction-v1:Splice.Api.Token.AllocationInstructionV1:AllocationFactory'
const CBTC_HOLDING_TID = 'Utility.Registry.Holding.V0.Holding:Holding'

// Coerce an unknown ledger field to a plain string (ledger decimals arrive as
// strings; anything non-scalar becomes '').
function asStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number') return String(v)
  return ''
}

// Read repo .env directly (this is a standalone devnet tool; it does not boot the
// backend env boundary). Strips one layer of surrounding quotes from each value.
async function readEnv(): Promise<Record<string, string>> {
  const raw = await Bun.file(`${import.meta.dir}/../../.env`).text()
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m === null) continue
    const key = m[1]
    if (key === undefined) continue
    out[key] = (m[2] ?? '').replace(/^["'](.*)["']$/, '$1')
  }
  return out
}

interface CbtcHolding {
  contractId: string
  amount: string
}

// Scan the ACS for the first UNLOCKED CBTC holding owned by us. A holding whose
// `lock` field is present and non-null is already committed elsewhere: skip it.
function findUnlockedHolding(acs: unknown): CbtcHolding | undefined {
  const entries = Array.isArray(acs) ? acs : []
  for (const entry of entries) {
    const ce = (
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
    if (!ce?.templateId?.includes(CBTC_HOLDING_TID)) continue
    const arg = ce.createArgument ?? {}
    const locked = arg.lock !== undefined && arg.lock !== null
    console.log(`  CBTC holding ${ce.contractId} amount=${asStr(arg.amount)} locked=${locked}`)
    if (!locked && ce.contractId !== undefined) {
      return { contractId: ce.contractId, amount: asStr(arg.amount) }
    }
  }
  return undefined
}

// Report the created contracts of an allocate transaction, classifying each as a
// completed Allocation vs a pending AllocationInstruction.
function reportCreated(tx: unknown): void {
  const events =
    (tx as { transaction?: { events?: Record<string, unknown>[] } }).transaction?.events ?? []
  const created: { templateId: string; contractId: string }[] = []
  for (const ev of events) {
    const c = ev.CreatedEvent as { templateId?: string; contractId?: string } | undefined
    if (c?.contractId !== undefined) {
      created.push({ templateId: c.templateId ?? '?', contractId: c.contractId })
    }
  }
  console.log(`\nLIVE LOCK SUCCEEDED. ${created.length} created contract(s):`)
  for (const c of created) {
    // A pending two-step lock creates an AllocationInstruction; a one-step lock
    // creates the registry Allocation directly (here a `DvpLegAllocation`).
    const kind = c.templateId.includes('AllocationInstruction')
      ? 'PENDING AllocationInstruction'
      : c.templateId.includes('Allocation')
        ? 'COMPLETED Allocation'
        : 'created'
    console.log(`  [${kind}] ${c.contractId}\n    template=${c.templateId}`)
  }
  if (created.length === 0) {
    console.log('  (no CreatedEvent in transaction; full tx below)')
    console.log(JSON.stringify(tx, null, 2).slice(0, 2000))
  }
}

async function main(): Promise<void> {
  const env = await readEnv()
  const ledgerUrl = env.LEDGER_API_URL ?? ''
  const registryUrl = env.REGISTRY_URL ?? ''
  const registrar = env.CBTC_NETWORK_PARTY ?? ''
  const me = env.OPERATOR_PARTY ?? ''
  const cfg = { baseUrl: ledgerUrl }

  console.log('1. Token grant (scope openid daml_ledger_api)...')
  const { access_token: token } = await keycloakPasswordGrant({
    tokenUrl: env.OIDC_TOKEN_URL ?? '',
    clientId: env.OIDC_CLIENT_ID ?? '',
    scope: 'openid daml_ledger_api',
    username: env.OIDC_USERNAME ?? '',
    password: env.OIDC_PASSWORD ?? '',
  })
  console.log('   token acquired (redacted)')

  console.log('2. Reading ACS for an unlocked CBTC holding...')
  const offset = await getLedgerEnd(cfg, token)
  const acs = await queryActiveContracts(cfg, token, {
    verbose: true,
    activeAtOffset: offset,
    filter: { filtersByParty: { [me]: {} } },
  })
  const holding = findUnlockedHolding(acs)
  if (!holding) throw new Error('no unlocked CBTC holding found on our ACS')
  console.log(`   -> using ${holding.contractId} amount=${holding.amount}`)

  // Strictly increasing timeline: requestedAt < allocateBefore < settleBefore. The
  // DvpLegAllocation precondition rejects equal allocate/settle deadlines.
  const now = new Date().toISOString()
  const allocateBefore = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  const settleBefore = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
  const amount = holding.amount || '0.01'
  const allocation = {
    settlement: {
      executor: me,
      settlementRef: { id: 'overwrite-collateral', cid: null },
      requestedAt: now,
      allocateBefore,
      settleBefore,
      meta: { values: {} },
    },
    transferLegId: 'collateral',
    transferLeg: {
      sender: me,
      receiver: me,
      amount,
      instrumentId: { admin: registrar, id: 'CBTC' },
      meta: { values: {} },
    },
  }
  const choiceArguments = {
    expectedAdmin: registrar,
    allocation,
    requestedAt: now,
    inputHoldingCids: [holding.contractId],
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  }

  console.log('3. Fetching allocation-factory choice context...')
  const fcc = await fetchAllocationFactoryChoiceContext(
    registryUrl,
    registrar,
    token,
    choiceArguments,
  )
  console.log(
    `   factoryId=${fcc.factoryId} disclosed=${fcc.disclosed.length} contextKeys=${Object.keys(fcc.context.contextValues ?? {}).length}`,
  )

  // Same choiceArguments, but now with the real fetched context in extraArgs.
  const exerciseArg = { ...choiceArguments, extraArgs: toExtraArgs(fcc.context) }
  const commandId = `overwrite-lock-${Date.now()}`
  const body = exerciseCommand({
    templateId: ALLOCATION_FACTORY_IID,
    contractId: fcc.factoryId,
    choice: 'AllocationFactory_Allocate',
    choiceArgument: exerciseArg,
    actAs: [me],
    commandId,
    disclosed: fcc.disclosed,
  })
  console.log('4. Submitting AllocationFactory_Allocate (VALUE-MOVING)...')
  console.log(`   commandId=${commandId}`)

  try {
    const tx = await submitAndWait(cfg, token, body)
    // SUCCESS: value is now locked. STOP. Do not re-submit.
    reportCreated(tx)
  } catch (e) {
    // An AppError(LGR_SUBMIT_FAIL) means the ledger returned a non-2xx: the command
    // was rejected and NOTHING committed. Re-POST the identical (rejected) body once,
    // raw, purely to surface the ledger's error body for diagnosis. Any OTHER error
    // (e.g. a parse error after a 2xx) may mean it DID commit: do NOT re-post then.
    if (e instanceof AppError && e.id === ErrorIds.LGR_SUBMIT_FAIL) {
      console.error(`\nSUBMIT REJECTED: ${e.message}`)
      const res = await fetch(`${ledgerUrl}/v2/commands/submit-and-wait-for-transaction`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      })
      const errText = await res.text()
      await Bun.write('/tmp/devnet-lock-error.json', errText)
      console.error(`ledger error body (HTTP ${res.status}):\n${errText.slice(0, 4000)}`)
    } else {
      console.error(`\nSUBMIT FAILED (non-rejection; may have committed): ${String(e)}`)
    }
    process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(`\nDEVNET-LOCK FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
