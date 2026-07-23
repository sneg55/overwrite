// Shared types for the JSON Ledger API client. The client is parameterized by
// config (not the env boundary directly), so it stays pure/testable and the env
// wiring happens once at an entrypoint.

export interface LedgerConfig {
  /** JSON Ledger API base URL, e.g. https://ledger-api-json.participant.<host> */
  baseUrl: string
  timeoutMs?: number
}

export interface LedgerVersion {
  version: string
  features?: unknown
}

export interface PartyInfo {
  party: string
  isLocal?: boolean
}
