#!/usr/bin/env bun
// Full covered-call lifecycle driven end-to-end against a live ledger through the
// backend's own request builders (backend/src/services/ledger-client/commands.ts).
// Proves v2 command encoding + transport for BOTH settlement paths on real Canton.
//
// Usage: `./scripts/sandbox.sh demo` (OTM then ITM), or
//   `bun scripts/demo-scenario {otm|itm|both}` with LEDGER_API_URL set.
// No-auth submits carry user-id participant_admin (sandbox token has no claims).
// Shared setup (parties -> lock -> write -> pay) + constants live in ./setup.
import { createCommand, exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import {
  allocationWindow,
  cidOf,
  createdAll,
  emptyExtraArgs,
  ledgerUrl,
  sleep,
  submit,
  USER_ID,
} from './ledger'
import { observe, STRIKE, setupThroughPremium, tid } from './setup'

// OTM: expiry price <= strike. Collateral withdraws back to the operator pool.
async function runOtm(suffix: string): Promise<void> {
  console.log('OTM path (expires worthless, collateral unwinds):')
  const ctx = await setupThroughPremium(suffix)
  await sleep(5000)
  const obs = await observe(ctx, '60000.0')
  const settle = await submit(
    exerciseCommand({
      templateId: tid('CallOption', 'CallOption'),
      contractId: ctx.option,
      choice: 'SettleOTM',
      // The collateral leg unwinds back to the vault. Empty context: the local
      // MockAllocation ignores it (the real registry keys a `withdraw` context here).
      choiceArgument: { obsCid: obs, cbtcContext: emptyExtraArgs() },
      actAs: [ctx.operator],
      commandId: `settle-otm-${suffix}`,
      userId: USER_ID,
    }),
  )
  const returned = cidOf(settle, 'Allocation', 'Holding')
  console.log(
    `  SettleOTM (60000 <= ${STRIKE}) -> collateral returned ${returned.slice(0, 12)}...\n`,
  )
}

// ITM: expiry price > strike. Atomic DvP: CBTC -> buyer, cash -> operator in one tx.
async function runItm(suffix: string): Promise<void> {
  console.log('ITM path (assigned, atomic DvP):')
  const ctx = await setupThroughPremium(suffix)
  // Buyer posts the exact strike cash (strike * notional) and allocates it.
  const buyerCash = cidOf(
    await submit(
      createCommand({
        templateId: tid('Allocation', 'Holding'),
        createArguments: {
          issuer: ctx.operator,
          owner: ctx.mmBuyer,
          instrument: 'mUSDC',
          amount: `${STRIKE}.0`,
        },
        actAs: [ctx.operator],
        commandId: `cash-hold-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'Holding',
  )
  // Allocate the cash leg for the operator (executor + ITM receiver). The times are a
  // demo window; SettleITM validates the cash leg by sender/asset/executor/amount, not
  // by these, and the local MockAllocation ignores them. Produces a MockAllocation.
  const cashAlloc = cidOf(
    await submit(
      exerciseCommand({
        templateId: tid('Allocation', 'Holding'),
        contractId: buyerCash,
        choice: 'Allocate',
        choiceArgument: {
          executor: ctx.operator,
          receiver: ctx.operator,
          // Lifetime 0: the cash leg backs no option, so nothing checks its window
          // against an expiry. It only has to satisfy assertValidAllocationWindow.
          ...allocationWindow(0),
        },
        actAs: [ctx.mmBuyer],
        commandId: `cash-alloc-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'MockAllocation',
  )
  await sleep(5000)
  const obs = await observe(ctx, '70000.0')
  const settle = await submit(
    exerciseCommand({
      templateId: tid('CallOption', 'CallOption'),
      contractId: ctx.option,
      choice: 'SettleITM',
      // Both legs move in one transaction. Empty contexts: the local MockAllocation
      // ignores the CBTC one, and the demo cash leg is mock USDC. Against the real
      // registry the CBTC leg carries an `execute-transfer` context (see the backend's
      // handlers-settle.ts), which is why the two legs are separate arguments.
      choiceArgument: {
        obsCid: obs,
        cashAllocationCid: cashAlloc,
        cbtcContext: emptyExtraArgs(),
        cashContext: emptyExtraArgs(),
      },
      actAs: [ctx.operator],
      commandId: `settle-itm-${suffix}`,
      userId: USER_ID,
    }),
  )
  // SettleITM is atomic: it committing means BOTH legs moved (a failed transfer
  // aborts the whole choice). The operator only *sees* the cash leg it received;
  // the CBTC leg (observer = buyer) is private to the buyer + issuer.
  const legs = createdAll(settle, 'Allocation', 'Holding')
  console.log(
    `  SettleITM (70000 > ${STRIKE}) -> atomic DvP committed: CBTC->buyer, cash->operator`,
  )
  console.log(
    `    (operator sees ${legs.length}/2 legs; the CBTC leg is private to the buyer + issuer)\n`,
  )
}

async function main(): Promise<void> {
  const mode = process.argv[2] ?? 'both'
  const base = String(Math.floor(Date.now() / 1000) % 100000)
  console.log(`Lifecycle vs ${ledgerUrl()} (no-auth, user-id ${USER_ID}), mode=${mode}\n`)
  if (mode === 'otm' || mode === 'both') await runOtm(`o${base}`)
  if (mode === 'itm' || mode === 'both') await runItm(`i${base}`)
  console.log('Done. Both settlement paths exercised on live Canton via the backend builders.')
}

main().catch((e) => {
  console.error(`\nFAILED: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
