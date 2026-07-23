#!/usr/bin/env bun
// Seed a rich, persistent demo epoch on the local sandbox so the REST API + web have
// real, party-scoped data. Runs a full active epoch and STOPS before settlement:
//   Vault -> 3 deposits -> consolidate -> lock -> write call -> pay premium ->
//   pay out premium to each depositor -> reopen the deposit window.
// The reopen at the end is what lets a visitor actually deposit into the seeded demo:
// lock/write leave the window Locked, so without it the deposit form has no open epoch.
// Resulting ledger state (what each party can actually see):
//   operator : Vault (window Open), 3 VaultPositions, active CallOption, 3 PremiumReceipts
//   mm-buyer : the CallOption (it is the counterparty)
//   alice    : her VaultPosition + her PremiumReceipt (NOT the vault/option)
//   observer : nothing
// No EpochReport yet (that is post-settlement). Reseed on every sandbox start.
//
// Writes .sandbox/demo.env (backend config) + demo.json (web party map). Run via
// `./scripts/sandbox.sh seed`.
import {
  allocateParty,
  allocationWindow,
  cidOf,
  emptyExtraArgs,
  ledgerUrl,
  relTime,
  USER_ID,
} from '../demo-scenario/ledger'
import { create, exercise } from './commands'

const DEPOSITORS = ['alice', 'bob', 'carol'] as const

// The seed leaves an epoch mid-flight for the UI to render, so the option must not
// expire while someone is clicking around: 7 days out, well past any demo session.
// LockCollateral runs before WriteCall and has to size its settlement window to cover
// this, so both read the one constant (Vault.WriteCall rejects an option that outlives
// its collateral, and a flat few-hours window fails that check).
const OPTION_LIFETIME_MS = 7 * 86_400_000

async function main(): Promise<void> {
  console.log(`Seeding a full active epoch on ${ledgerUrl()}\n`)

  const operator = await allocateParty('operator')
  const oracle = await allocateParty('oracle')
  const mmBuyer = await allocateParty('mm-buyer')
  const cbtcIssuer = await allocateParty('cbtc-issuer')
  const observer = await allocateParty('observer')
  const dp: Record<string, string> = {}
  for (const d of DEPOSITORS) dp[d] = await allocateParty(d)
  console.log('parties: operator, oracle, mm-buyer, cbtc-issuer, observer, alice, bob, carol')

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
      id: 'seed-vault',
    }),
    'Vault',
    'Vault',
  )

  // Registry AllocationFactory stand-in (labeled). LockCollateral allocates the pool
  // through the real CIP-56 factory interface; admin = the CBTC issuer (carries issuer
  // authority), user = operator (demo-visibility observer). Devnet swaps this for the
  // registry's own public factory reached via disclosed contracts.
  const factoryCid = cidOf(
    await create({
      m: 'Allocation',
      t: 'MockAllocationFactory',
      args: { admin: cbtcIssuer, user: operator },
      actAs: [cbtcIssuer],
      id: 'seed-factory',
    }),
    'Allocation',
    'MockAllocationFactory',
  )

  // 3 deposits: each mints 1.0 CBTC, then Deposit -> VaultPosition + operator pool piece.
  const positions: { d: string; cid: string }[] = []
  const poolPieces: string[] = []
  for (const d of DEPOSITORS) {
    const cbtc = cidOf(
      await create({
        m: 'Allocation',
        t: 'Holding',
        args: { issuer: cbtcIssuer, owner: dp[d], instrument: 'CBTC', amount: '1.0' },
        actAs: [cbtcIssuer],
        id: `seed-cbtc-${d}`,
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
      id: `seed-dep-${d}`,
    })
    vault = cidOf(dep, 'Vault', 'Vault')
    positions.push({ d, cid: cidOf(dep, 'VaultPosition', 'VaultPosition') })
    poolPieces.push(cidOf(dep, 'Allocation', 'Holding'))

    // Leave each depositor a free (undeposited) CBTC balance in their own wallet, so the
    // position page shows a wallet with something to deposit. `Holding` is observed by
    // its owner, so this is visible to the depositor (and no one else) via GET /holdings.
    // Funded here at seed; on devnet this is the depositor's own faucet holding.
    await create({
      m: 'Allocation',
      t: 'Holding',
      args: { issuer: cbtcIssuer, owner: dp[d], instrument: 'CBTC', amount: '2.0' },
      actAs: [cbtcIssuer],
      id: `seed-wallet-${d}`,
    })
  }
  console.log(`deposits: ${positions.length} positions (alice, bob, carol) @ 1.0 CBTC`)
  console.log('wallets: 2.0 free CBTC each (available to deposit)')

  // Consolidate the 3 operator CBTC pieces into one 3.0 pool.
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
        id: `seed-merge-${i}`,
      }),
      'Allocation',
      'Holding',
    )
  }

  // Lock the pool (CIP-56 allocation), write a fully-covered call, MM pays the premium.
  const lock = await exercise({
    m: 'Vault',
    t: 'Vault',
    cid: vault,
    choice: 'LockCollateral',
    arg: {
      cbtcPoolCid: pool,
      mmBuyer,
      factoryCid,
      allocContext: emptyExtraArgs(),
      ...allocationWindow(OPTION_LIFETIME_MS),
    },
    actAs: [operator],
    id: 'seed-lock',
  })
  const vault1 = cidOf(lock, 'Vault', 'Vault')
  const allocation = cidOf(lock, 'Allocation', 'MockAllocation')
  const expiry = new Date(Date.now() + OPTION_LIFETIME_MS).toISOString()
  const option = cidOf(
    await exercise({
      m: 'Vault',
      t: 'Vault',
      cid: vault1,
      choice: 'WriteCall',
      arg: {
        mmBuyer,
        collateralAllocationCid: allocation,
        spotAtOpen: '60000.0',
        premiumUsdc: '300.0',
        notionalCbtc: '3.0',
        expiry,
      },
      actAs: [operator, mmBuyer],
      id: 'seed-write',
    }),
    'CallOption',
    'CallOption',
  )
  const buyerPrem = cidOf(
    await create({
      m: 'Allocation',
      t: 'Holding',
      args: { issuer: operator, owner: mmBuyer, instrument: 'mUSDC', amount: '300.0' },
      actAs: [operator],
      id: 'seed-prem',
    }),
    'Allocation',
    'Holding',
  )
  await exercise({
    m: 'CallOption',
    t: 'CallOption',
    cid: option,
    choice: 'PayPremium',
    arg: { premiumCid: buyerPrem },
    actAs: [mmBuyer],
    id: 'seed-pay',
  })
  console.log(
    'option: written + premium paid (Active), notional 3.0 CBTC, strike 66000, premium 300',
  )

  // Pay each depositor their pro-rata premium (100 each) -> PremiumReceipt.
  for (const { d, cid } of positions) {
    const cash = cidOf(
      await create({
        m: 'Allocation',
        t: 'Holding',
        args: { issuer: operator, owner: operator, instrument: 'mUSDC', amount: '100.0' },
        actAs: [operator],
        id: `seed-cash-${d}`,
      }),
      'Allocation',
      'Holding',
    )
    await exercise({
      m: 'VaultPosition',
      t: 'VaultPosition',
      cid,
      choice: 'PayoutPremium',
      arg: { premiumUsdc: '100.0', usdcCid: cash, transferRef: `epoch-1-${d}` },
      actAs: [operator],
      id: `seed-payout-${d}`,
    })
  }
  console.log('receipts: 3 premium receipts (100 mUSDC each)')

  // Reopen the deposit window on the (now Locked) vault so the seeded demo is
  // immediately depositable: the populated book above stays, and a visitor can deposit
  // into the current epoch. New deposits raise totalPooledCbtc past the already-locked
  // collateral, which is fine here because the seed never re-locks; a depositor who
  // deposits again shows a second position for the same epoch, a known demo simplification.
  const vaultOpen = cidOf(
    await exercise({
      m: 'Vault',
      t: 'Vault',
      cid: vault1,
      choice: 'OpenDeposits',
      arg: {},
      actAs: [operator],
      id: 'seed-open',
    }),
    'Vault',
    'Vault',
  )
  console.log('window: reopened for deposits (windowState = Open)')

  // Friendly-name -> party-id + a demo bearer token per party (SESSIONS binds
  // token->party server-side; the web sends `demo-<name>`).
  const parties: Record<string, string> = { operator, 'mm-buyer': mmBuyer, observer, ...dp }
  const tokens: Record<string, string> = {}
  const sessionPairs: string[] = []
  for (const [name, party] of Object.entries(parties)) {
    tokens[name] = `demo-${name}`
    sessionPairs.push(`demo-${name}=${party}`)
  }

  const envLines = [
    '# Generated by scripts/seed-demo. Local no-auth backend config.',
    'NODE_ENV=development',
    'PORT=3001',
    'LEDGER_LOCAL=true',
    `LEDGER_API_URL=${ledgerUrl()}`,
    `SANDBOX_USER_ID=${USER_ID}`,
    `OPERATOR_PARTY=${operator}`,
    `ORACLE_PARTY=${oracle}`,
    `MM_BUYER_PARTY=${mmBuyer}`,
    '# Zod-required but unused locally (no real registry on the sandbox):',
    'REGISTRY_URL=http://localhost',
    'CBTC_NETWORK_PARTY=local-sandbox',
    `SESSIONS=${sessionPairs.join(',')}`,
    '',
  ]
  await Bun.write('.sandbox/demo.env', envLines.join('\n'))
  await Bun.write(
    '.sandbox/demo.json',
    `${JSON.stringify({ vaultCid: vaultOpen, optionCid: option, parties, tokens }, null, 2)}\n`,
  )
  console.log(
    '\nWrote .sandbox/demo.env (backend) + demo.json (web). Start backend: ./scripts/sandbox.sh serve',
  )
}

main().catch((e) => {
  console.error(`\nSEED FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
