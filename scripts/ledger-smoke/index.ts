#!/usr/bin/env bun
// Spike 0.1 plumbing smoke test: prove we can reach the HackCanton devnet JSON
// Ledger API and authenticate against Keycloak.
//
// Usage:
//   bun scripts/ledger-smoke            # version only (no auth needed)
//   bun scripts/ledger-smoke --auth     # also fetch a token + list parties (needs creds)
//
// Config via env (see .env.example). The version check needs no auth; the --auth
// path needs OIDC_USERNAME + OIDC_PASSWORD (your personal HackCanton credentials).

const LEDGER_API_URL =
  process.env.LEDGER_API_URL ??
  'https://ledger-api-json.participant.hackcanton-01.devnet.naas.noders.services'
const OIDC_TOKEN_URL =
  process.env.OIDC_TOKEN_URL ??
  'https://keycloak.naas.noders.services/realms/noders-appsfactory/protocol/openid-connect/token'
const OIDC_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'web-app-ui-hackcanton-01-devnet'
const OIDC_SCOPE = process.env.OIDC_SCOPE ?? 'openid daml_ledger_api offline_access'
const TIMEOUT_MS = 15_000

async function getVersion(): Promise<string> {
  const res = await fetch(`${LEDGER_API_URL}/v2/version`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`GET /v2/version -> HTTP ${res.status}`)
  const body = (await res.json()) as { version?: string }
  return body.version ?? '(unknown)'
}

async function getToken(username: string, password: string): Promise<string> {
  const res = await fetch(OIDC_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: OIDC_CLIENT_ID,
      scope: OIDC_SCOPE,
      username,
      password,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`token endpoint -> HTTP ${res.status}: ${text}`)
  const body = JSON.parse(text) as { access_token?: string }
  if (body.access_token === undefined) throw new Error('token response missing access_token')
  return body.access_token
}

// Confirm the token by reading the authenticated user. This is a *user-tier*
// endpoint: our SSO login is a single-party user, not participant admin, so the
// admin-tier `/v2/parties` and `/v2/users` return 403 (see docs/spikes/
// 0.1-allocation-cycle.md, "Auth findings"). Hitting an admin call here would make
// --auth always fail even when auth succeeds. /v2/authenticated-user also returns
// our primary party id, which is what later funding + ACS reads key off.
async function getPrimaryParty(token: string): Promise<string> {
  const res = await fetch(`${LEDGER_API_URL}/v2/authenticated-user`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`GET /v2/authenticated-user -> HTTP ${res.status}`)
  const body = (await res.json()) as { user?: { primaryParty?: string } }
  const party = body.user?.primaryParty
  if (party === undefined) throw new Error('authenticated-user response missing user.primaryParty')
  return party
}

async function main(): Promise<number> {
  const version = await getVersion()
  console.log(`JSON Ledger API reachable at ${LEDGER_API_URL} -> Canton ${version}`)

  if (!process.argv.includes('--auth')) {
    console.log('Version check only. Pass --auth (with OIDC_USERNAME/OIDC_PASSWORD) to test auth.')
    return 0
  }

  const username = process.env.OIDC_USERNAME
  const password = process.env.OIDC_PASSWORD
  if (username === undefined || password === undefined) {
    console.error('Set OIDC_USERNAME and OIDC_PASSWORD in the environment for --auth.')
    return 1
  }

  const token = await getToken(username, password)
  console.log(`Got bearer token (${token.length} chars).`)
  const party = await getPrimaryParty(token)
  console.log(`Authenticated JSON Ledger API call OK (user-tier): primary party ${party}`)
  return 0
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    console.error(`ledger-smoke failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
