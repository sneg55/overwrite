// Keycloak (OIDC password grant) authentication for the JSON Ledger API, with an
// in-memory token cache that refreshes before expiry. Verified endpoint shape:
// HackCanton realm `noders-appsfactory`, client `web-app-ui-hackcanton-01-devnet`,
// scope `openid daml_ledger_api offline_access`.

import { AppError, ErrorIds } from '@/constants/errorIds'

export interface OidcConfig {
  tokenUrl: string
  clientId: string
  scope: string
  username: string
  password: string
}

export interface TokenResponse {
  access_token: string
  expires_in: number
}

const DEFAULT_TIMEOUT_MS = 15_000

export async function keycloakPasswordGrant(
  cfg: OidcConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<TokenResponse> {
  const res = await fetch(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'password',
      client_id: cfg.clientId,
      scope: cfg.scope,
      username: cfg.username,
      password: cfg.password,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) {
    throw new AppError(ErrorIds.LGR_AUTH_FAIL, `token grant failed: HTTP ${res.status}`)
  }
  const body = (await res.json()) as Partial<TokenResponse>
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new AppError(ErrorIds.LGR_AUTH_FAIL, 'token response missing access_token/expires_in')
  }
  return { access_token: body.access_token, expires_in: body.expires_in }
}

export type TokenFetcher = () => Promise<TokenResponse>

/**
 * Caches a bearer token and refreshes it `skewMs` before it actually expires, so
 * a request never races the expiry boundary. Clock + fetcher are injected for
 * testability.
 */
export class TokenCache {
  private token: string | undefined
  private expiresAtMs = 0

  constructor(
    private readonly fetcher: TokenFetcher,
    private readonly now: () => number = Date.now,
    private readonly skewMs: number = 30_000,
  ) {}

  async get(): Promise<string> {
    if (this.token !== undefined && this.now() < this.expiresAtMs - this.skewMs) {
      return this.token
    }
    const r = await this.fetcher()
    this.token = r.access_token
    this.expiresAtMs = this.now() + r.expires_in * 1_000
    return r.access_token
  }
}
