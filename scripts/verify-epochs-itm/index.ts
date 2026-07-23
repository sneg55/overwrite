#!/usr/bin/env bun
// End-to-end ITM check. With the engine running against an itm-seeded sandbox, the
// oracle steps its labeled demo price up past the strike mid-epoch, the MM reads the
// same schedule and allocates strike cash, and the operator settles ITM. Poll as
// operator until an epoch settles ITM, then assert the close-and-distribute path:
// an EpochReport with settlementPath ITM, and NOTHING rolled forward (ITM closes every
// position against its share of the strike proceeds; unlike OTM it rolls no principal).
import { acsFilter, overwriteTemplateId } from '../../backend/src/services/ledger-client/commands'
import {
  type ActiveContract,
  parseActiveContracts,
} from '../../backend/src/services/ledger-client/parse'

const LEDGER = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
const OPERATOR = process.env.OPERATOR_PARTY ?? ''
const TIMEOUT_MS = 180_000
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

// settlementPath and epochNumber arrive as JSON strings over the wire; anything else
// is treated as absent rather than coerced (which would stringify an object to junk).
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const toEpoch = (v: unknown): number =>
  typeof v === 'string' || typeof v === 'number' ? Number(v) : Number.NaN
const epochsOf = (cs: ActiveContract[]): number[] => cs.map((c) => toEpoch(c.payload.epochNumber))

function fail(msg: string): never {
  console.error(`\nVERIFY-ITM FAILED: ${msg}`)
  process.exit(1)
}

// An ITM report is in; assert the close-and-distribute shape and exit. Never returns.
async function assertOutcome(itmEpoch: number): Promise<never> {
  const positions = await query('VaultPosition', 'VaultPosition')
  const observations = await query('PriceObservation', 'PriceObservation')
  const posEpochs = epochsOf(positions)
  const stillOpenAtEpoch = posEpochs.filter((e) => e === itmEpoch).length
  const rolledForward = posEpochs.filter((e) => e === itmEpoch + 1).length
  if (observations.length < 1) fail('no PriceObservation found (oracle did not run)')
  if (stillOpenAtEpoch !== 0)
    fail(
      `expected the ITM epoch's positions closed, found ${stillOpenAtEpoch} still at epoch ${itmEpoch}`,
    )
  // The ITM branch closes and distributes; it must roll no principal. An OTM epoch would
  // instead leave 3 positions at epoch itmEpoch+1. Zero here is the distinguishing proof.
  if (rolledForward !== 0)
    fail(
      `ITM must not roll principal forward, found ${rolledForward} positions at epoch ${itmEpoch + 1}`,
    )
  console.log('\nVERIFY-ITM OK:')
  console.log(`  EpochReport epoch ${itmEpoch}: settlementPath ITM (settle -> record -> close)`)
  console.log(
    `  positions closed (none at epoch ${itmEpoch}); nothing rolled to epoch ${itmEpoch + 1}`,
  )
  console.log(`  PriceObservations: ${observations.length} (oracle stepped base -> late)`)
  process.exit(0)
}

async function main(): Promise<void> {
  if (OPERATOR === '') fail('OPERATOR_PARTY not set (source .sandbox/demo.env)')
  console.log(`Watching one ITM epoch on ${LEDGER} (operator ${OPERATOR.slice(0, 16)}...)`)
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    const reports = await query('EpochReport', 'EpochReport')
    const itm = reports.find((c) => str(c.payload.settlementPath) === 'ITM')
    if (itm !== undefined) {
      // RecordEpoch stamps the ITM report before RollPositions closes the epoch's
      // positions on a later tick; give the roll a moment, then assert the close.
      await sleep(POLL_MS)
      await assertOutcome(toEpoch(itm.payload.epochNumber))
    }
    const seen = reports.map(
      (c) => `${toEpoch(c.payload.epochNumber)}:${str(c.payload.settlementPath)}`,
    )
    console.log(`  ...reports so far: [${seen.join(', ')}]`)
    await sleep(POLL_MS)
  }
  fail(`timed out after ${TIMEOUT_MS / 1000}s waiting for an ITM EpochReport`)
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)))
