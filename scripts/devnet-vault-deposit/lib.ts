// Task 8 helpers: env + party parsing, devnet reads (unlocked CBTC, the operator vault,
// registry allocations, pending offers), the vault create, and the read-back proof.
// Kept out of index.ts so the orchestration stays under the file-size limit.

import type { SchedulerConfig } from '../../backend/src/features/epoch-scheduler/config'
import type { RealDepositConfig } from '../../backend/src/features/rest-api/deposit-real'
import { getLedgerEnd, queryActiveContracts } from '../../backend/src/services/ledger-client/client'
import {
  type HoldingRead,
  parseRealHoldings,
  REAL_CBTC_HOLDING_TID,
} from '../../backend/src/services/ledger-client/real-holdings'
import { LedgerSession } from '../../backend/src/services/ledger-client/session'
import type { LedgerConfig } from '../../backend/src/services/ledger-client/types'

export const TRANSFER_OFFER_TID =
  '#utility-registry-app-v0:Utility.Registry.App.V0.Model.Transfer:TransferOffer'
// 1 hour, in ms. The window must satisfy assertValidAllocationWindow: allocateBefore in
// the future, settleBefore >= allocateBefore + the vault's settleBufferSeconds (also 1h).
export const HOUR_MS = 60 * 60 * 1000

export function asStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

export async function readEnv(): Promise<Record<string, string>> {
  const raw = await Bun.file(`${import.meta.dir}/../../.env`).text()
  const out: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m?.[1] === undefined) continue
    out[m[1]] = (m[2] ?? '').replace(/^["'](.*)["']$/, '$1')
  }
  return out
}

function sessionParty(env: Record<string, string>, name: string): string {
  for (const pair of (env.SESSIONS ?? '').split(',')) {
    const [k, v] = pair.split('=')
    if (k?.trim() === `demo-${name}` && v !== undefined) return v.trim()
  }
  throw new Error(`demo-${name} not found in SESSIONS`)
}

// One JsActiveContract createdEvent, keeping templateId (parseActiveContracts drops it).
function createdEventOf(
  entry: unknown,
):
  | { templateId?: string; contractId?: string; createArgument?: Record<string, unknown> }
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

export interface Ctx {
  session: LedgerSession
  ledger: LedgerConfig
  operator: string
  alice: string
  registrar: string
  sched: SchedulerConfig
  deposit: RealDepositConfig
}

export function buildCtx(env: Record<string, string>): Ctx {
  const ledger: LedgerConfig = { baseUrl: env.LEDGER_API_URL ?? '' }
  const session = new LedgerSession({
    ledger,
    oidc: {
      tokenUrl: env.OIDC_TOKEN_URL ?? '',
      clientId: env.OIDC_CLIENT_ID ?? '',
      scope: 'openid daml_ledger_api',
      username: env.OIDC_USERNAME ?? '',
      password: env.OIDC_PASSWORD ?? '',
    },
  })
  const operator = env.OPERATOR_PARTY ?? ''
  const registrar = env.CBTC_NETWORK_PARTY ?? ''
  const registryUrl = env.REGISTRY_URL ?? ''
  const sched: SchedulerConfig = {
    operator,
    oracle: env.ORACLE_PARTY ?? '',
    mmBuyer: env.MM_BUYER_PARTY ?? '',
    cashInstrument: 'mUSDC',
    epochLengthMs: HOUR_MS,
    depositWindowMs: HOUR_MS,
    tickMs: 2_000,
    premiumBps: 100,
    allocateWindowMs: HOUR_MS,
    settleBufferMs: HOUR_MS,
    useRealRegistry: true,
    registryUrl,
    registrar,
  }
  const deposit: RealDepositConfig = {
    ledger,
    token: () => session.token(),
    registryUrl,
    registrar,
    operator,
  }
  return { session, ledger, operator, alice: sessionParty(env, 'alice'), registrar, sched, deposit }
}

export async function unlockedCbtc(ctx: Ctx, party: string): Promise<HoldingRead[]> {
  const offset = await ctx.session.ledgerEnd()
  const acs = await ctx.session.queryRawAt(offset, party, REAL_CBTC_HOLDING_TID)
  return parseRealHoldings(acs, ctx.registrar).filter((h) => h.instrument === 'CBTC')
}

export function largest(hs: HoldingRead[]): HoldingRead | undefined {
  return hs.reduce<HoldingRead | undefined>(
    (best, h) => (best === undefined || Number(h.amount) > Number(best.amount) ? h : best),
    undefined,
  )
}

export interface VaultState {
  cid: string
  windowState: string
  epoch: string
  total: string
}

export async function operatorVault(ctx: Ctx): Promise<VaultState | undefined> {
  const acs = await ctx.session.query(ctx.operator, 'Vault', 'Vault')
  const v = acs[0]
  if (v === undefined) return undefined
  return {
    cid: v.contractId,
    windowState: asStr(v.payload.windowState),
    epoch: asStr(v.payload.epochNumber),
    total: asStr(v.payload.totalPooledCbtc),
  }
}

export interface AllocRow {
  cid: string
  template: string
  amount: string
}

// Registry allocation contracts on the operator's ACS (the real DvpLegAllocation the
// lock creates), excluding the factory/instruction/mock templates that also match.
export async function operatorAllocations(ctx: Ctx): Promise<AllocRow[]> {
  const token = await ctx.session.token()
  const offset = await getLedgerEnd(ctx.ledger, token)
  const acs = await queryActiveContracts(ctx.ledger, token, {
    verbose: true,
    activeAtOffset: offset,
    filter: { filtersByParty: { [ctx.operator]: {} } },
  })
  const out: AllocRow[] = []
  for (const entry of Array.isArray(acs) ? acs : []) {
    const ce = createdEventOf(entry)
    const tid = ce?.templateId ?? ''
    if (ce?.contractId === undefined) continue
    if (!/Allocation/.test(tid)) continue
    if (/AllocationInstruction|AllocationFactory|MockAllocation/.test(tid)) continue
    out.push({ cid: ce.contractId, template: tid, amount: asStr(ce.createArgument?.amount) })
  }
  return out
}

// Pending offers to the operator FROM alice (the ones the deposit will accept). Unrelated
// senders' offers to the operator are ignored by the depositor-scoped accept.
export async function aliceOffersToOperator(ctx: Ctx): Promise<number> {
  const offset = await ctx.session.ledgerEnd()
  const acs = await ctx.session.queryRawAt(offset, ctx.operator, TRANSFER_OFFER_TID)
  return acs.filter((c) => {
    const tr = c.payload.transfer as { receiver?: unknown; sender?: unknown } | undefined
    return tr?.receiver === ctx.operator && tr.sender === ctx.alice
  }).length
}

export async function createVault(ctx: Ctx, env: Record<string, string>): Promise<VaultState> {
  const oneHourMicros = String(HOUR_MS * 1000)
  const tx = await ctx.session.create({
    module: 'Vault',
    template: 'Vault',
    createArguments: {
      operator: ctx.operator,
      oracleParty: env.ORACLE_PARTY ?? '',
      epochNumber: '1',
      windowState: 'Open',
      strikePct: '0.1',
      premiumSplitPct: '1.0',
      cashInstrument: 'mUSDC',
      maxObservationAge: { microseconds: oneHourMicros },
      settleBufferSeconds: { microseconds: oneHourMicros },
      totalPooledCbtc: '0.0',
      minDepositCbtc: '0.001',
    },
    actAs: [ctx.operator],
    commandId: `t8-vault-${Date.now()}`,
  })
  const created = tx.created.find((c) => c.templateId.endsWith('Overwrite.Vault:Vault'))
  if (created === undefined) throw new Error('vault create returned no Vault contract')
  return { cid: created.contractId, windowState: 'Open', epoch: '1', total: '0.0' }
}

export function printHoldings(label: string, hs: HoldingRead[]): void {
  console.log(`${label} (${hs.length}):`)
  for (const h of hs) console.log(`  ${h.cid.slice(0, 24)}... amount=${h.amount}`)
}

export async function readBackProof(
  ctx: Ctx,
  allocBefore: AllocRow[],
  sourceAmount: string,
): Promise<void> {
  const vault = await operatorVault(ctx)
  const positions = await ctx.session.query(ctx.operator, 'VaultPosition', 'VaultPosition')
  const alicePos = positions.find((p) => asStr(p.payload.depositor) === ctx.alice)
  const beforeSet = new Set(allocBefore.map((a) => a.cid))
  const newAllocs = (await operatorAllocations(ctx)).filter((a) => !beforeSet.has(a.cid))
  const opUnlocked = await unlockedCbtc(ctx, ctx.operator)
  const poolGone = opUnlocked.every((h) => Math.abs(Number(h.amount) - Number(sourceAmount)) > 1e-9)

  console.log('\n=== PROOF (read from the ledger) ===')
  console.log(`  Vault windowState = ${vault?.windowState} (expect Locked)`)
  console.log(`  alice VaultPosition principalCbtc = ${asStr(alicePos?.payload.principalCbtc)}`)
  console.log(`  new CBTC allocation(s): ${newAllocs.length}`)
  for (const a of newAllocs) {
    console.log(`    ${a.cid.slice(0, 24)}...  ${a.template}  amount=${a.amount}`)
  }
  console.log(
    `  operator's ${sourceAmount} unlocked CBTC now locked (gone from spendable): ${poolGone}`,
  )
  console.log(
    '\nReversal (to recover the devnet CBTC): withdraw the allocation, then transfer the CBTC back to alice.',
  )
}
