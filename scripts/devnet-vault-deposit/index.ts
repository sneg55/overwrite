#!/usr/bin/env bun
// Task 8 (Phase 1 devnet proof): deposit and lock REAL CBTC THROUGH THE VAULT on devnet,
// single depositor. Drives the actual backend methods (not a re-implementation):
//   (a) depositRealWhole  -> registry move (two-step: TransferFactory_Transfer + operator
//       accept) then Vault.RecordDeposit, exercising the 1.1.0-only RecordDeposit choice.
//   (b) the scheduler lockCollateral handler in real mode -> Vault.LockCollateralReal,
//       which calls the real registry AllocationFactory to lock the pooled CBTC.
// Then reads back the three proof contracts: Vault (windowState Locked), alice's
// VaultPosition (principalCbtc), and the new CBTC allocation on the ledger.
//
// Modes (repo root, PATH including ~/.bun/bin):
//   bun run scripts/devnet-vault-deposit/index.ts --dry-run   # READ-ONLY: state + plan
//   bun run scripts/devnet-vault-deposit/index.ts --execute   # VALUE-MOVING: move + lock
//
// SAFETY: a REJECTED submission moves no value, so --dry-run is free. --execute moves the
// whole unlocked alice CBTC holding into operator custody and LOCKS it in a real
// allocation (reversible: withdraw the allocation, transfer the CBTC back to alice). The
// moment the lock succeeds we STOP and print proof; re-running detects the Locked vault
// and only re-reads. Never prints the OIDC token.

import { liveRegistry } from '../../backend/src/features/epoch-scheduler/handlers'
// lockCollateral moved to handlers-lock.ts when the pool-consolidation fix pushed
// handlers.ts past the file-size limit.
import { lockCollateral } from '../../backend/src/features/epoch-scheduler/handlers-lock'
import { readTick } from '../../backend/src/features/epoch-scheduler/reads'
import { depositRealWhole } from '../../backend/src/features/rest-api/deposit-real'
import {
  aliceOffersToOperator,
  buildCtx,
  createVault,
  largest,
  operatorAllocations,
  operatorVault,
  printHoldings,
  readBackProof,
  readEnv,
  unlockedCbtc,
} from './lib'

async function main(): Promise<void> {
  const mode = process.argv.includes('--execute') ? 'execute' : 'dry-run'
  const env = await readEnv()
  const ctx = buildCtx(env)
  console.log(
    `mode=${mode} alice=${ctx.alice.split('::')[0]} operator=${ctx.operator.split('::')[0]}\n`,
  )

  const aliceCbtc = await unlockedCbtc(ctx, ctx.alice)
  printHoldings('alice unlocked CBTC', aliceCbtc)
  printHoldings('operator unlocked CBTC', await unlockedCbtc(ctx, ctx.operator))
  const source = largest(aliceCbtc)
  if (source === undefined) throw new Error('no unlocked alice CBTC holding to deposit')

  let vault = await operatorVault(ctx)
  console.log(
    vault === undefined
      ? '\noperator vault: none (execute would create one)'
      : `\noperator vault: ${vault.cid.slice(0, 24)}... windowState=${vault.windowState} epoch=${vault.epoch} total=${vault.total}`,
  )
  const aliceOffers = await aliceOffersToOperator(ctx)

  if (mode !== 'execute') {
    console.log('\n[dry-run] --execute would:')
    if (vault === undefined) console.log('  1. create a Vault (Open, epoch 1, minDeposit 0.001)')
    console.log(
      `  2. deposit alice's ${source.amount} CBTC (${source.cid.slice(0, 16)}...): registry`,
    )
    console.log(
      `     move -> accept -> Vault.RecordDeposit. Accepts ${aliceOffers} pending offer(s)`,
    )
    console.log('     from alice to operator (offers from other senders are ignored).')
    console.log('  3. lockCollateral (real): Vault.LockCollateralReal -> real AllocationFactory.')
    console.log('\nRe-run with --execute to submit (moves + locks real CBTC).')
    return
  }

  if (vault?.windowState === 'Locked') {
    console.log('\nvault already Locked; deposit+lock already ran. Re-reading proof only.')
    await readBackProof(ctx, await operatorAllocations(ctx), source.amount)
    return
  }
  if (vault !== undefined && vault.windowState !== 'Open') {
    throw new Error(`vault in unexpected state ${vault.windowState}; expected Open or Locked`)
  }

  if (vault === undefined) {
    console.log('\n[execute] creating vault...')
    vault = await createVault(ctx, env)
    console.log(`  created ${vault.cid.slice(0, 24)}...`)
  }

  // Deposit only if the vault has no prior deposits (a re-run after a mid-way crash keeps
  // the already-deposited pool and just locks it).
  if (Number(vault.total) <= 0) {
    console.log('\n[execute] depositing (registry move + accept + RecordDeposit)...')
    await depositRealWhole(ctx.deposit, ctx.alice, vault.cid, source.cid, source.amount)
    vault = await operatorVault(ctx)
    console.log(`  deposited: vault total now ${vault?.total}`)
  } else {
    console.log(`\n[execute] vault already has ${vault.total} pooled; skipping deposit.`)
  }

  const allocBefore = await operatorAllocations(ctx)
  console.log('\n[execute] locking collateral (real AllocationFactory)...')
  const reads = await readTick(ctx.session, ctx.sched)
  if (reads === null) throw new Error('readTick returned null (no vault on the ledger)')
  if (reads.poolHoldingCid === undefined) throw new Error('no operator CBTC pool holding to lock')
  await lockCollateral({ session: ctx.session, reads, cfg: ctx.sched, registry: liveRegistry })
  console.log('  lock submitted.')

  await readBackProof(ctx, allocBefore, source.amount)
}

main().catch((e) => {
  console.error(`\nDEVNET-VAULT-DEPOSIT FAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
