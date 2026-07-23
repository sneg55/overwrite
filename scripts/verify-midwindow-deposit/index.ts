#!/usr/bin/env bun
// End-to-end regression check: a deposit that lands while the deposit
// window is open must not wedge the vault.
//
// This is the one combination no other check in the repo produces. `sandbox.sh demo`
// never runs the engine. `verify` / `verify-itm` run the engine but nobody deposits
// mid-epoch, so the operator only ever holds the single consolidated pool holding the
// seed built. `bun test` cannot see it at all: the bug was in WHICH contract gets
// picked out of real ledger state, which a stubbed ledger client cannot reproduce.
//
// What it drives, against a running engine (`sandbox.sh seed-vault && sandbox.sh engine`):
//   1. pause the scheduler on an OPEN deposit window (next action LockCollateral)
//   2. allocate and fund a fresh depositor, so this is a legitimate first position
//      rather than the one-per-epoch case the gateway refuses
//   3. exercise Vault.Deposit for them, fragmenting the operator's CBTC into two
//      holdings while totalPooledCbtc counts both
//   4. resume, and assert the vault advances two further epochs with no tick error
//
// Before the fix this hung at step 4 forever: the lock picked the largest single
// holding, which could no longer cover the pool, so LockCollateral was rejected on
// every tick.
import { readFileSync, writeFileSync } from 'node:fs'
import { createCommand, exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import { allocateParty, cidOf, ledgerUrl, submit, USER_ID } from '../demo-scenario/ledger'

const STATE = '.sandbox'
const TIMEOUT_MS = 180_000
const POLL_MS = 250
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

interface Status {
  nextAction: string | null
  lastAction: string | null
  lastError: string | null
}

// Both control files are written lazily: the scheduler owns status, the REST server
// owns intent, and on a freshly seeded sandbox with no operator clicks yet neither
// need exist. Treat "not there" as "nothing has happened", not as an error.
const NO_STATUS: Status = { nextAction: null, lastAction: null, lastError: null }

function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(`${STATE}/${name}`, 'utf8')) as T
  } catch {
    return fallback
  }
}

const status = (): Status => readJson('engine-status.json', NO_STATUS)

function setPaused(paused: boolean): void {
  // stepSeq is monotonic and consumed by the scheduler; carry it through unchanged so
  // pausing never reads as a step request.
  const intent = readJson('engine-intent.json', { stepSeq: 0 })
  writeFileSync(
    `${STATE}/engine-intent.json`,
    `${JSON.stringify({ paused, stepSeq: intent.stepSeq }, null, 2)}\n`,
  )
}

async function waitFor(label: string, done: () => boolean): Promise<void> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (done()) return
    await sleep(POLL_MS)
  }
  throw new Error(`TIMED OUT waiting for ${label}`)
}

async function vaultState(
  operator: string,
): Promise<{ cid: string; epoch: number; windowState: string }> {
  const res = await fetch(`${ledgerUrl()}/v2/state/ledger-end`)
  const { offset } = (await res.json()) as { offset: number }
  const body = {
    verbose: true,
    activeAtOffset: offset,
    filter: {
      filtersByParty: {
        [operator]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: {
                    templateId: '#overwrite-vault:Overwrite.Vault:Vault',
                    includeCreatedEventBlob: false,
                  },
                },
              },
            },
          ],
        },
      },
    },
  }
  const acs = (await (
    await fetch(`${ledgerUrl()}/v2/state/active-contracts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  ).json()) as {
    contractEntry?: {
      JsActiveContract?: {
        createdEvent?: { contractId: string; createArgument: Record<string, unknown> }
      }
    }
  }[]
  const created = acs.map((e) => e.contractEntry?.JsActiveContract?.createdEvent).filter(Boolean)[0]
  if (created === undefined) throw new Error('no Vault on the ledger; run seed-vault first')
  return {
    cid: created.contractId,
    epoch: Number(created.createArgument.epochNumber),
    windowState: String(created.createArgument.windowState),
  }
}

/**
 * Pause the scheduler with the deposit window actually OPEN.
 *
 * Asking for it is not enough: the window is open for roughly one tick per epoch, so a
 * pause requested on that tick usually lands after the lock has already closed it.
 * Pause first, then read the vault back, and release and retry if the window shut in
 * the meantime. The windowState on the ledger is the authority here, not the
 * scheduler's own next-action guess.
 */
async function pauseOnOpenWindow(operator: string): Promise<{ cid: string; epoch: number }> {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    await waitFor('a roll', () => status().lastAction === 'Roll')
    setPaused(true)
    await sleep(1_200)
    const vault = await vaultState(operator)
    if (vault.windowState === 'Open') return { cid: vault.cid, epoch: vault.epoch }
    setPaused(false)
    await sleep(1_000)
  }
  throw new Error('TIMED OUT trying to pause on an open deposit window')
}

async function main(): Promise<void> {
  const seeded = JSON.parse(readFileSync(`${STATE}/demo.json`, 'utf8')) as {
    parties: Record<string, string>
  }
  const operator = seeded.parties.operator ?? ''
  const namespace = operator.split('::')[1] ?? ''
  const cbtcIssuer = `cbtc-issuer::${namespace}`

  console.log(`verify-midwindow-deposit vs ${ledgerUrl()}\n`)

  // 1. Pause on an open window. `lastAction: Roll` is the moment the window reopens;
  // `nextAction: LockCollateral` is the tick that would close it again.
  console.log('waiting for an open deposit window...')
  const before = await pauseOnOpenWindow(operator)
  console.log(`  paused at epoch ${before.epoch} with the deposit window open`)

  // 2. A fresh depositor, so this is a first position and not the one-per-epoch case
  // the gateway refuses (Vault.RecordEpoch asserts `unique depositors`).
  const dave = await allocateParty(`dave-${Date.now().toString(36)}`)
  const holding = cidOf(
    await submit(
      createCommand({
        templateId: '#overwrite-vault:Overwrite.Allocation:Holding',
        createArguments: { issuer: cbtcIssuer, owner: dave, instrument: 'CBTC', amount: '0.5' },
        actAs: [cbtcIssuer],
        commandId: `vmd-fund-${Date.now()}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'Holding',
  )
  console.log(`  funded a new depositor with 0.5 CBTC`)

  // 3. Deposit into the open window. This is what fragments the operator's CBTC.
  await submit(
    exerciseCommand({
      templateId: '#overwrite-vault:Overwrite.Vault:Vault',
      contractId: before.cid,
      choice: 'Deposit',
      choiceArgument: { depositor: dave, cbtcCid: holding, topUpPositionCid: null },
      actAs: [dave, operator],
      commandId: `vmd-deposit-${Date.now()}`,
      userId: USER_ID,
    }),
  )
  console.log('  deposited mid-window: the operator now holds two CBTC holdings')

  // 4. Resume and require real progress, not just the absence of a crash.
  setPaused(false)
  const target = before.epoch + 2
  console.log(`resuming; requiring the vault to reach epoch ${target}...`)
  // Read the epoch rather than trusting the absence of an error: the second failure
  // on this path (the premium fan-out) produced no error at all, it just re-dispatched
  // the same action forever. Only the epoch counter moving proves the vault is alive.
  let last = before.epoch
  const deadline = Date.now() + TIMEOUT_MS
  while (last < target && Date.now() < deadline) {
    const err = status().lastError
    if (err !== null) throw new Error(`scheduler tick failed after the deposit: ${err}`)
    last = (await vaultState(operator)).epoch
    if (last < target) await sleep(POLL_MS)
  }
  if (last < target) {
    throw new Error(`TIMED OUT: vault stuck at epoch ${last}, wanted ${target} (wedged)`)
  }

  console.log(`\nVERIFY-MIDWINDOW-DEPOSIT OK:`)
  console.log(`  deposit landed on an open window at epoch ${before.epoch}`)
  console.log(`  vault advanced to epoch ${last} with no scheduler tick error`)
}

main().catch((e: unknown) => {
  // Always hand the engine back. A failed run that leaves the scheduler paused looks
  // exactly like the wedge this check exists to detect, and poisons the next run.
  try {
    setPaused(false)
  } catch {
    console.error('  (could not resume the engine; check .sandbox/engine-intent.json)')
  }
  console.error(`\nVERIFY-MIDWINDOW-DEPOSIT FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
