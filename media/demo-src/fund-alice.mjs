// Video support only: give alice a free CBTC holding on the LOCAL sandbox so the
// deposit scene can be recorded against the same engine-driven state as every other
// UI scene. `seed-vault` (the engine seed) puts every depositor's CBTC straight into
// the pool and leaves their wallet empty, which is right for the engine and wrong for
// filming a deposit. `seed-demo` funds wallets instead, but stops before the lock, so
// it cannot produce the live epoch footage. This closes that one gap.
//
//   export PATH="$HOME/.bun/bin:$PATH" && bun run media/demo-src/fund-alice.mjs
//
// Local sandbox only: it mints through the demo `cbtc-issuer` party, which exists
// nowhere but here. Real CBTC is faucet-funded and never minted by this project.
import { readFileSync } from 'node:fs'
import { createCommand } from '../../backend/src/services/ledger-client/commands'
import { submit, USER_ID } from '../../scripts/demo-scenario/ledger'

// Party ids are derived from the seed's own record rather than re-allocated: party
// allocation is not idempotent, so asking for `cbtc-issuer` a second time is a 400.
const seeded = JSON.parse(readFileSync('.sandbox/demo.json', 'utf8'))
const alice = seeded.parties.alice
const namespace = alice.split('::')[1]
const cbtcIssuer = `cbtc-issuer::${namespace}`

const result = await submit(
  createCommand({
    templateId: '#overwrite-vault:Overwrite.Allocation:Holding',
    createArguments: { issuer: cbtcIssuer, owner: alice, instrument: 'CBTC', amount: '2.0' },
    actAs: [cbtcIssuer],
    commandId: `video-fund-alice-${process.argv[2] ?? '1'}`,
    userId: USER_ID,
  }),
)

console.log(`funded alice with 2.0 CBTC (${JSON.stringify(result).slice(0, 120)}...)`)
