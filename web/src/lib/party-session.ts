// Server-side acting-party session. The party switcher sets a cookie; every server
// component reads it here and scopes its data accordingly (see ledger-view.ts).
// This is what makes the privacy reveal real: the empty observer view is produced
// on the server, so nothing another party can't see is ever sent to the browser.

import { cookies } from 'next/headers'
import { PARTY_COOKIE, type Party } from './parties'
import { resolveDefaultParty } from './party-default'

// DEMO NOTE: the acting party is selected by a client-set cookie, which is fine for
// the demo privacy-reveal but is NOT an auth boundary. Production must bind the party
// to an authenticated server session, so the cold-load default never runs there. The
// default resolution (cookie, else demo env, else the production-safe `observer`) lives
// in resolveDefaultParty; see party-default.ts for the security rationale.
export async function getActingParty(): Promise<Party> {
  const store = await cookies()
  const value = store.get(PARTY_COOKIE)?.value
  return resolveDefaultParty(value, process.env.OVERWRITE_DEMO_DEFAULT_PARTY)
}
