#!/usr/bin/env bun
// End-to-end check: with the engine running against a seeded sandbox, poll the ledger
// as operator until two epochs complete, then assert the success criteria. Also greps
// the scheduler handlers to prove the operator process never pays premium or writes a
// price observation (those belong to the MM and oracle processes, separately partied).
import { acsFilter, overwriteTemplateId } from '../../backend/src/services/ledger-client/commands'
import {
  type ActiveContract,
  parseActiveContracts,
} from '../../backend/src/services/ledger-client/parse'

const LEDGER = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const OPERATOR = process.env.OPERATOR_PARTY ?? ''
const TIMEOUT_MS = 240_000
const POLL_MS = 3_000
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${LEDGER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

// ledger-end is a GET (a POST 405s with a plain-text body that would break res.json);
// active-contracts is the POST. This mirrors the backend ledger-client exactly.
async function ledgerEnd(): Promise<number> {
  const res = await fetch(`${LEDGER}/v2/state/ledger-end`, { signal: AbortSignal.timeout(20_000) })
  if (!res.ok) throw new Error(`GET /v2/state/ledger-end -> HTTP ${res.status}`)
  const json = (await res.json()) as { offset?: number }
  return json.offset ?? 0
}

async function query(module: string, template: string): Promise<ActiveContract[]> {
  const offset = await ledgerEnd()
  const body = acsFilter({
    party: OPERATOR,
    templateId: overwriteTemplateId(module, template),
    activeAtOffset: offset,
  })
  return parseActiveContracts(await post('/v2/state/active-contracts', body))
}

// epochNumber arrives as a JSON string (Daml Int over the wire) or a number; coerce
// only those, never an object (avoids '[object Object]' stringification).
const toEpoch = (v: unknown): number =>
  typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN
const epochsOf = (cs: ActiveContract[]): number[] => cs.map((c) => toEpoch(c.payload.epochNumber))

function fail(msg: string): never {
  console.error(`\nVERIFY FAILED: ${msg}`)
  process.exit(1)
}

async function scanScheduler(): Promise<void> {
  const files = [
    'backend/src/features/epoch-scheduler/handlers.ts',
    'backend/src/features/epoch-scheduler/handlers-settle.ts',
  ]
  for (const f of files) {
    const text = await Bun.file(f).text()
    if (text.includes('PayPremium')) fail(`${f} references PayPremium (must be MM-only)`)
    if (
      /PriceObservation'?\s*,?\s*\n?\s*template:\s*'PriceObservation'/.test(text) ||
      text.includes("template: 'PriceObservation'")
    )
      fail(`${f} creates a PriceObservation (must be oracle-only)`)
  }
}

// Both EpochReports are in; query the rest and assert the definition of done. Never
// returns: it either prints VERIFY OK and exits 0, or fails with the first violation.
async function assertOutcome(): Promise<never> {
  const positions = await query('VaultPosition', 'VaultPosition')
  const receipts = await query('PremiumReceipt', 'PremiumReceipt')
  const observations = await query('PriceObservation', 'PriceObservation')
  const r1 = epochsOf(receipts).filter((e) => e === 1).length
  const r2 = epochsOf(receipts).filter((e) => e === 2).length
  // r2 === 3 (asserted below) proves 3 positions rolled into epoch 2: each epoch-2
  // PremiumReceipt is a PayoutPremium on a position present at epoch 2. A live position
  // count is not asserted, because by the time both reports exist those positions may
  // have already rolled on to epoch 3 (RecordEpoch for epoch 2 advances the vault),
  // which would race a live count to 0 on a slower host.
  const liveAtEpoch2 = epochsOf(positions).filter((e) => e === 2).length
  if (r1 !== 3) fail(`expected 3 PremiumReceipts for epoch 1, found ${r1}`)
  if (r2 !== 3)
    fail(`expected 3 PremiumReceipts for epoch 2 (proves the roll into epoch 2), found ${r2}`)
  if (observations.length < 1) fail('no PriceObservation found (oracle did not run)')
  console.log('\nVERIFY OK:')
  console.log('  EpochReports: epochs 1 and 2 present')
  console.log(
    `  positions rolled into epoch 2: proven by 3 epoch-2 receipts (${liveAtEpoch2} still live at epoch 2)`,
  )
  console.log(`  PremiumReceipts: epoch1=${r1}, epoch2=${r2}`)
  console.log(`  PriceObservations: ${observations.length} (oracle-created)`)
  console.log('  scheduler handlers contain no PayPremium and no PriceObservation create')
  process.exit(0)
}

async function main(): Promise<void> {
  if (OPERATOR === '') fail('OPERATOR_PARTY not set (source .sandbox/demo.env)')
  await scanScheduler()
  console.log(`Watching two epochs complete on ${LEDGER} (operator ${OPERATOR.slice(0, 16)}...)`)
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const reports = await query('EpochReport', 'EpochReport')
    const reportEpochs = new Set(epochsOf(reports))
    if (reportEpochs.has(1) && reportEpochs.has(2)) await assertOutcome()
    console.log(`  ...epochs recorded so far: [${[...reportEpochs].sort().join(', ')}]`)
    await sleep(POLL_MS)
  }
  fail(`timed out after ${TIMEOUT_MS / 1000}s waiting for two EpochReports`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
