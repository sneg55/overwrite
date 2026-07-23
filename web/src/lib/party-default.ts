import { isParty, type Party } from './parties'

// Pure cold-load party resolution, split out from party-session so it is unit-testable
// without mocking `next/headers` and without tripping the process-wide `mock.module`
// that other suites apply to '@/lib/party-session' (see party-default.test.ts).
//
// This default is security-relevant. It is PRODUCTION-SAFE BY DEFAULT: with no demo env
// set, a cold load (no cookie) resolves to `observer` (sees nothing), so an
// unauthenticated first view never receives another party's data. The demo sets
// OVERWRITE_DEMO_DEFAULT_PARTY=operator to land a fresh visitor on the vault's full book;
// an unset or invalid value falls back to `observer`. Privacy is always enforced by the
// ledger's per-party ACS, never by this default.
export function resolveDefaultParty(
  cookieValue: string | undefined,
  envDefault: string | undefined,
): Party {
  if (isParty(cookieValue)) return cookieValue
  return isParty(envDefault) ? envDefault : 'observer'
}
