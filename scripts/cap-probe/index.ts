#!/usr/bin/env bun
// Probe for the JSON API's list-element cap.
//
// Creates more contracts than the default 200-element ceiling for one party, then reads
// the ACS back. Without a raised cap the read fails HTTP 413
// (JSON_API_MAXIMUM_LIST_ELEMENTS_NUMBER_REACHED); with it, every contract comes back.
// This is what tells a config override apart from a config that parsed and then did
// nothing, which is the failure a "the sandbox started fine" check cannot see.
//
// Run against a sandbox started with CANTON_CONFIG=deploy/canton-demo.conf:
//   bun scripts/cap-probe [count]
import { createCommand } from '../../backend/src/services/ledger-client/commands'
import { allocateParty, ledgerUrl, submit, USER_ID } from '../demo-scenario/ledger'

const COUNT = Number(process.argv[2] ?? 260)

async function main(): Promise<void> {
  const issuer = await allocateParty('capissuer')
  const owner = await allocateParty('capowner')
  console.log(`creating ${COUNT} holdings on ${ledgerUrl()}`)
  for (let i = 0; i < COUNT; i++) {
    await submit(
      createCommand({
        templateId: '#overwrite-vault:Overwrite.Allocation:Holding',
        createArguments: { issuer, owner, instrument: 'CBTC', amount: '0.001' },
        actAs: [issuer],
        commandId: `cap-probe-${i}`,
        userId: USER_ID,
      }),
    )
  }

  const endRes = await fetch(`${ledgerUrl()}/v2/state/ledger-end`)
  const end = (await endRes.json()) as { offset: number }
  const res = await fetch(`${ledgerUrl()}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      verbose: false,
      activeAtOffset: end.offset,
      filter: { filtersByParty: { [owner]: { cumulative: [] } } },
    }),
  })
  const body = await res.text()
  if (!res.ok) {
    console.log(`ACS read FAILED http ${res.status}: ${body.slice(0, 200)}`)
    process.exit(1)
  }
  const contracts = JSON.parse(body) as unknown[]
  console.log(`ACS read OK: ${contracts.length} contracts returned (cap is above ${COUNT})`)
}

main().catch((e) => {
  console.error(`cap-probe failed: ${e instanceof Error ? e.message : String(e)}`)
  process.exit(1)
})
