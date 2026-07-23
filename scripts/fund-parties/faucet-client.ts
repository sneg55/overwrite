// Thin client over the CBTC devnet faucet (plain JSON API, no auth).
//
// HOST NOTE (2026-07-13): the faucet moved to per-network subdomains. The apex
// https://cbtc-faucet.bitsafe.finance still serves the web UI but its /api is dead
// (`/api/networks` -> `{"networks":[]}`, every network "Unknown"). The live API is
// https://cbtc-faucet.devnet.bitsafe.finance (and https://cbtc-faucet.testnet…).
// `/api/networks` is the authoritative liveness/discovery check.
//
// Verified against https://cbtc-faucet.devnet.bitsafe.finance on 2026-07-13:
//   GET  /api/networks              -> { networks: [{ name, display_name }] }
//   GET  /api/limits/{network}      -> { min_amount, max_amount }
//   GET  /api/balance/{network}     -> { network, party_id, balance, utxo_count }
//         NOTE: returns a single fixed default party; it ignores any party query
//         param. Per-party balances must be read from the ledger, not the faucet.
//   POST /api/faucet                -> body { network, recipient_party, amount }
//         NOTE (verified live 2026-07-10): the field is `recipient_party`, not
//         `party`, and `amount` must be a STRING (a float is rejected 422). The
//         2026-07-06 note here was wrong on both counts.
//
// Party ids are in `hint::1220...` format. Rate limits are unknown; fund politely.

const DEFAULT_BASE_URL = 'https://cbtc-faucet.devnet.bitsafe.finance'
const REQUEST_TIMEOUT_MS = 15_000

export interface FaucetNetwork {
  name: string
  display_name: string
}

export interface FaucetLimits {
  min_amount: number
  max_amount: number
}

export interface FaucetBalance {
  network: string
  party_id: string
  balance: number
  utxo_count: number
}

export interface FaucetConfig {
  baseUrl: string
  network: string
}

export function loadFaucetConfig(): FaucetConfig {
  return {
    baseUrl: process.env.FAUCET_URL ?? DEFAULT_BASE_URL,
    network: process.env.FAUCET_NETWORK ?? 'devnet',
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!res.ok) {
    throw new Error(`GET ${url} -> HTTP ${res.status} ${res.statusText}`)
  }
  return (await res.json()) as T
}

export async function getNetworks(cfg: FaucetConfig): Promise<FaucetNetwork[]> {
  const body = await getJson<{ networks: FaucetNetwork[] }>(`${cfg.baseUrl}/api/networks`)
  return body.networks
}

export async function getLimits(cfg: FaucetConfig): Promise<FaucetLimits> {
  return await getJson<FaucetLimits>(`${cfg.baseUrl}/api/limits/${cfg.network}`)
}

/**
 * The faucet's default-party balance for the network. This does NOT accept an
 * arbitrary party (the endpoint ignores party args), so use it only as a
 * reachability/liveness check. Read real per-party balances from the ledger.
 */
export async function getDefaultBalance(cfg: FaucetConfig): Promise<FaucetBalance> {
  return await getJson<FaucetBalance>(`${cfg.baseUrl}/api/balance/${cfg.network}`)
}

export interface FundResult {
  party: string
  amount: number
  ok: boolean
  detail: string
}

export async function fundParty(
  cfg: FaucetConfig,
  party: string,
  amount: number,
): Promise<FundResult> {
  const res = await fetch(`${cfg.baseUrl}/api/faucet`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // The faucet wants `recipient_party` (not `party`) and a string `amount`
    // (a JSON number is rejected 422). Verified live 2026-07-10.
    body: JSON.stringify({
      network: cfg.network,
      recipient_party: party,
      amount: String(amount),
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  const text = await res.text()
  return {
    party,
    amount,
    ok: res.ok,
    detail: res.ok ? text || 'ok' : `HTTP ${res.status}: ${text}`,
  }
}

export function clampAmount(amount: number, limits: FaucetLimits): number {
  return Math.min(Math.max(amount, limits.min_amount), limits.max_amount)
}

export function isPartyId(value: string): boolean {
  // Canton party ids used by the faucet look like `<hint>::1220<hex>`.
  return /^[^:]+::1220[0-9a-f]+$/i.test(value)
}
