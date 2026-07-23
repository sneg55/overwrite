// Thin wrapper over the Canton JSON Ledger API v2. Endpoints confirmed against the
// HackCanton devnet (Canton 3.5.6):
//   GET  /v2/version                                        (unauthenticated)
//   GET  /v2/parties                                        (bearer)
//   POST /v2/commands/submit-and-wait-for-transaction-tree  (bearer)
//   POST /v2/state/active-contracts                         (bearer)
//
// getVersion / listParties are fully wired. The command-submission and ACS-query
// BODY encoding (JsCommands / active-contracts filter) must be finalized against
// the OpenAPI spec with a live token during spike 0.1, so those take a prebuilt
// body for now rather than a fabricated schema.

import { AppError, type ErrorId, ErrorIds } from '@/constants/errorIds'
import type { LedgerConfig, LedgerVersion, PartyInfo } from './types'

const DEFAULT_TIMEOUT_MS = 15_000

function timeoutMs(cfg: LedgerConfig): number {
  return cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS
}

// Only send Authorization when there is a token. A no-auth ledger (e.g. a local
// Canton sandbox) rejects an empty `Bearer ` header outright.
function authHeader(token: string): Record<string, string> {
  return token.length > 0 ? { authorization: `Bearer ${token}` } : {}
}

export async function getVersion(cfg: LedgerConfig): Promise<LedgerVersion> {
  const res = await fetch(`${cfg.baseUrl}/v2/version`, {
    signal: AbortSignal.timeout(timeoutMs(cfg)),
  })
  if (!res.ok) {
    throw new AppError(ErrorIds.LGR_QUERY_FAIL, `version: HTTP ${res.status}`)
  }
  return (await res.json()) as LedgerVersion
}

export async function listParties(cfg: LedgerConfig, token: string): Promise<PartyInfo[]> {
  const res = await fetch(`${cfg.baseUrl}/v2/parties`, {
    headers: { ...authHeader(token) },
    signal: AbortSignal.timeout(timeoutMs(cfg)),
  })
  if (!res.ok) {
    throw new AppError(ErrorIds.LGR_QUERY_FAIL, `parties: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { partyDetails?: PartyInfo[] }
  return body.partyDetails ?? []
}

/** Current ledger end offset, required as `activeAtOffset` for ACS queries. */
export async function getLedgerEnd(cfg: LedgerConfig, token: string): Promise<number> {
  const res = await fetch(`${cfg.baseUrl}/v2/state/ledger-end`, {
    headers: { ...authHeader(token) },
    signal: AbortSignal.timeout(timeoutMs(cfg)),
  })
  if (!res.ok) {
    throw new AppError(ErrorIds.LGR_QUERY_FAIL, `ledger-end: HTTP ${res.status}`)
  }
  const body = (await res.json()) as { offset?: number }
  return body.offset ?? 0
}

interface PostArgs {
  cfg: LedgerConfig
  token: string
  path: string
  body: unknown
  errorId: ErrorId
}

async function authedPost(args: PostArgs): Promise<unknown> {
  const { cfg, token, path, body, errorId } = args
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader(token) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs(cfg)),
  })
  if (!res.ok) {
    // Carry the ledger's own reason, not just the status. Canton puts the real cause
    // in the body (PACKAGE_NAMES_NOT_FOUND, the failed assertMsg text, CONTRACT_NOT_FOUND),
    // and dropping it turns every rejection into an indistinguishable "HTTP 400" that has
    // to be re-derived by hand from the scheduler logs. Truncated because an interpretation
    // error can carry a whole transaction trace. Canton error bodies carry no credentials;
    // the bearer token is only ever sent, never echoed.
    const detail = await res.text().catch(() => '')
    const reason = detail === '' ? '' : `: ${detail.slice(0, 400)}`
    throw new AppError(errorId, `POST ${path}: HTTP ${res.status}${reason}`)
  }
  return await res.json()
}

export async function submitAndWait(
  cfg: LedgerConfig,
  token: string,
  jsCommandsBody: unknown,
): Promise<unknown> {
  return await authedPost({
    cfg,
    token,
    path: '/v2/commands/submit-and-wait-for-transaction',
    body: jsCommandsBody,
    errorId: ErrorIds.LGR_SUBMIT_FAIL,
  })
}

export async function queryActiveContracts(
  cfg: LedgerConfig,
  token: string,
  filterBody: unknown,
): Promise<unknown> {
  return await authedPost({
    cfg,
    token,
    path: '/v2/state/active-contracts',
    body: filterBody,
    errorId: ErrorIds.LGR_QUERY_FAIL,
  })
}
