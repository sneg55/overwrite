// Read-only: print the CURRENT devnet state behind the video's devnet-proof card, so
// the card quotes something observed today rather than a number remembered from a
// prior run. Reuses scripts/devnet-vault-deposit/lib.ts, which is what actually drove
// the Task 8 proof. Never submits, never prints the OIDC token.
//
//   export PATH="$HOME/.bun/bin:$PATH" && bun run media/demo-src/read-devnet-proof.mjs
import {
  buildCtx,
  operatorAllocations,
  operatorVault,
  readEnv,
  unlockedCbtc,
  asStr,
} from '../../scripts/devnet-vault-deposit/lib.ts'

const env = await readEnv()
const ctx = buildCtx(env)

const vault = await operatorVault(ctx)
const positions = await ctx.session.query(ctx.operator, 'VaultPosition', 'VaultPosition')
const allocs = await operatorAllocations(ctx)
const opUnlocked = await unlockedCbtc(ctx, ctx.operator)

console.log('=== devnet: live read ===')
console.log(`vault cid          ${vault?.cid.slice(0, 16)}...`)
console.log(`vault windowState  ${vault?.windowState}`)
console.log(`vault epoch        ${vault?.epoch}   totalPooledCbtc ${vault?.total}`)
console.log(`positions          ${positions.length}`)
for (const p of positions) {
  console.log(
    `  ${asStr(p.payload.depositor).split('::')[0]}  principalCbtc=${asStr(p.payload.principalCbtc)}`,
  )
}
console.log(`allocations        ${allocs.length}`)
for (const a of allocs) {
  console.log(`  ${a.cid.slice(0, 16)}...  ${a.template.split(':').slice(-1)[0]}  amount=${a.amount}`)
}
console.log(`operator unlocked  ${opUnlocked.length} holding(s)`)
