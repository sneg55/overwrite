#!/usr/bin/env bun
// Seed a bare active epoch for the THREE-PROCESS engine: a Vault (Open) + 3 deposits
// (positions + one consolidated operator CBTC pool) + a large MM mock-USDCx balance.
// Unlike seed-demo, this STOPS before LockCollateral: the scheduler/oracle/mm
// processes drive lock -> write -> pay -> distribute -> settle -> record -> roll.
// Writes .sandbox/demo.env (engine config) + demo.json.
//
// `bun scripts/seed-vault itm` emits a forced-ITM demo clock: the oracle opens the
// epoch at a base price (strike = base * 1.1) and steps up to a late price past the
// switch, so settlement lands ITM. The MM reads the same schedule and exercises. The
// epoch is stretched so the open read lands before the switch and settlement after it.
import { createCommand, exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import type { SubmitResult } from '../demo-scenario/ledger'
import { allocateParty, cidOf, ledgerUrl, relTime, submit, USER_ID } from '../demo-scenario/ledger'

const tid = (m: string, t: string): string => `#overwrite-vault:Overwrite.${m}:${t}`
const DEPOSITORS = ['alice', 'bob', 'carol'] as const

interface CreateSpec {
  m: string
  t: string
  args: Record<string, unknown>
  actAs: string[]
  id: string
}
interface ExSpec {
  m: string
  t: string
  cid: string
  choice: string
  arg: Record<string, unknown>
  actAs: string[]
  id: string
}
const create = (s: CreateSpec): Promise<SubmitResult> =>
  submit(
    createCommand({
      templateId: tid(s.m, s.t),
      createArguments: s.args,
      actAs: s.actAs,
      commandId: s.id,
      userId: USER_ID,
    }),
  )
const exercise = (s: ExSpec): Promise<SubmitResult> =>
  submit(
    exerciseCommand({
      templateId: tid(s.m, s.t),
      contractId: s.cid,
      choice: s.choice,
      choiceArgument: s.arg,
      actAs: s.actAs,
      commandId: s.id,
      userId: USER_ID,
    }),
  )

async function main(): Promise<void> {
  console.log(`Seeding a bare vault for the engine on ${ledgerUrl()}\n`)
  const operator = await allocateParty('operator')
  const oracle = await allocateParty('oracle')
  const mmBuyer = await allocateParty('mm-buyer')
  const cbtcIssuer = await allocateParty('cbtc-issuer')
  const observer = await allocateParty('observer')
  const dp: Record<string, string> = {}
  for (const d of DEPOSITORS) dp[d] = await allocateParty(d)

  // Deposit is consuming: it archives the vault it's called on and returns the
  // next one, so `vault` must be reassigned after every deposit below.
  let vault = cidOf(
    await create({
      m: 'Vault',
      t: 'Vault',
      args: {
        operator,
        oracleParty: oracle,
        epochNumber: '1',
        windowState: 'Open',
        strikePct: '0.1',
        premiumSplitPct: '1.0',
        cashInstrument: 'mUSDC',
        maxObservationAge: relTime(3_600_000_000),
        settleBufferSeconds: relTime(3_600_000_000),
        totalPooledCbtc: '0.0',
        minDepositCbtc: '0.001',
      },
      actAs: [operator],
      id: 'seedv-vault',
    }),
    'Vault',
    'Vault',
  )

  // Fund the MM once with a large mock-USDCx balance (operator is the issuer). The MM
  // carves exact premium/strike chunks from this across epochs.
  await create({
    m: 'Allocation',
    t: 'Holding',
    args: { issuer: operator, owner: mmBuyer, instrument: 'mUSDC', amount: '1000000.0' },
    actAs: [operator],
    id: 'seedv-mmfund',
  })

  // Create the registry AllocationFactory stand-in once (LockCollateral is
  // nonconsuming on it, so it lives for the whole demo). admin = the CBTC issuer
  // (the factory carries issuer authority); user = operator, the demo-visibility
  // observer so the engine can read + exercise it.
  const factoryCid = cidOf(
    await create({
      m: 'Allocation',
      t: 'MockAllocationFactory',
      args: { admin: cbtcIssuer, user: operator },
      actAs: [cbtcIssuer],
      id: 'seedv-factory',
    }),
    'Allocation',
    'MockAllocationFactory',
  )

  // 3 deposits -> VaultPosition + operator CBTC pool pieces.
  const poolPieces: string[] = []
  for (const d of DEPOSITORS) {
    const cbtc = cidOf(
      await create({
        m: 'Allocation',
        t: 'Holding',
        args: { issuer: cbtcIssuer, owner: dp[d], instrument: 'CBTC', amount: '1.0' },
        actAs: [cbtcIssuer],
        id: `seedv-cbtc-${d}`,
      }),
      'Allocation',
      'Holding',
    )
    const dep = await exercise({
      m: 'Vault',
      t: 'Vault',
      cid: vault,
      choice: 'Deposit',
      arg: { depositor: dp[d], cbtcCid: cbtc, topUpPositionCid: null },
      actAs: [operator, dp[d]],
      id: `seedv-dep-${d}`,
    })
    vault = cidOf(dep, 'Vault', 'Vault')
    poolPieces.push(cidOf(dep, 'Allocation', 'Holding'))
  }

  // The hosted demo is writable, so a visitor must have something to deposit. Every
  // holding minted above is spent into the opening positions, which leaves each
  // depositor's wallet empty and the deposit form with nothing to select. Off by
  // default: the verify gates read the wallet as a signal, and silently handing them a
  // spare balance would change what they prove.
  if (process.env.SEED_FUND_WALLETS === '1') {
    for (const d of DEPOSITORS) {
      await create({
        m: 'Allocation',
        t: 'Holding',
        args: { issuer: cbtcIssuer, owner: dp[d], instrument: 'CBTC', amount: '2.0' },
        actAs: [cbtcIssuer],
        id: `seedv-wallet-${d}`,
      })
    }
    console.log('wallets: 2.0 free CBTC each (available to deposit)')
  }

  // Consolidate the 3 pieces into ONE 3.0 pool so LockCollateral covers the notional.
  let pool = poolPieces[0]
  for (let i = 1; i < poolPieces.length; i++) {
    pool = cidOf(
      await exercise({
        m: 'Allocation',
        t: 'Holding',
        cid: pool,
        choice: 'Merge',
        arg: { otherCid: poolPieces[i] },
        actAs: [operator],
        id: `seedv-merge-${i}`,
      }),
      'Allocation',
      'Holding',
    )
  }
  console.log(
    'seeded: vault Open, 3 positions, one 3.0 CBTC pool, MM funded. Stopping before lock.',
  )

  const parties: Record<string, string> = { operator, 'mm-buyer': mmBuyer, oracle, observer, ...dp }
  const sessionPairs = Object.entries(parties).map(([name, party]) => `demo-${name}=${party}`)
  // Forced-ITM mode stretches the epoch so the open price read (a few ticks in) lands
  // before the switch and settlement (after expiry) lands after it, with wide margin.
  const itm = process.argv[2] === 'itm'
  const epochLenMs = itm ? 30_000 : 15_000
  const itmLines = itm
    ? [
        '# Forced-ITM demo price schedule (labeled). base opens the epoch (strike = base',
        '# * 1.1 = 66000); late settles it ITM after the switch. Oracle + MM both read it.',
        'ORACLE_DEMO_PRICE=60000.0',
        'ORACLE_DEMO_PRICE_LATE=80000.0',
        'ORACLE_DEMO_SWITCH_MS=15000',
      ]
    : []
  const envLines = [
    '# Generated by scripts/seed-vault. Local no-auth engine config.',
    'NODE_ENV=development',
    'LEDGER_LOCAL=true',
    `LEDGER_API_URL=${ledgerUrl()}`,
    `SANDBOX_USER_ID=${USER_ID}`,
    `OPERATOR_PARTY=${operator}`,
    `ORACLE_PARTY=${oracle}`,
    `MM_BUYER_PARTY=${mmBuyer}`,
    'CASH_INSTRUMENT=mUSDC',
    '# Compressed demo clock (engine params; never literals in code):',
    `EPOCH_LENGTH_MS=${epochLenMs}`,
    'TICK_MS=2000',
    'ORACLE_POLL_MS=3000',
    'PREMIUM_BPS=100',
    'STRIKE_PCT=0.1',
    ...itmLines,
    '# Zod-required but unused locally (no real registry on the sandbox):',
    'REGISTRY_URL=http://localhost',
    'CBTC_NETWORK_PARTY=local-sandbox',
    `SESSIONS=${sessionPairs.join(',')}`,
    '',
  ]
  await Bun.write('.sandbox/demo.env', envLines.join('\n'))
  await Bun.write(
    '.sandbox/demo.json',
    `${JSON.stringify({ vaultCid: vault, factoryCid, parties }, null, 2)}\n`,
  )
  console.log(
    '\nWrote .sandbox/demo.env + demo.json. Start the engine: ./scripts/sandbox.sh engine',
  )
}

main().catch((e) => {
  console.error(`\nSEED-VAULT FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
