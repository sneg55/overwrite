// Pure projections over ledger reads used by the REST handlers in server.ts.
// Split out so server.ts stays under the file-size threshold and so each logic
// branch is independently unit-testable (see router.test.ts), the same pattern
// already used for currentVaultResponse.

import type { ActiveContract } from '@/services/ledger-client/parse'

// GET /holdings only ever returns CBTC: a depositor's premium (mUSDC) lives on
// PremiumReceipt, not Holding, so any non-CBTC instrument on this template would
// be a ledger surprise, not a valid response row. Filter it out rather than leak it.
export function filterCbtcHoldings(holdings: ActiveContract[]): ActiveContract[] {
  return holdings.filter((h) => h.payload.instrument === 'CBTC')
}

// GET /current-vault joins the Vault's epochNumber against the CallOption written
// for that epoch. Before Market Making writes the option for a freshly-opened
// epoch, there is no match: callers see expiry: null until one appears.
export function optionForEpoch(
  options: ActiveContract[],
  epochNumber: unknown,
): ActiveContract | undefined {
  return options.find((o) => o.payload.epochNumber === epochNumber)
}
