# backend

TypeScript on the Canton JSON Ledger API. Runs on **bun**.

## Implemented so far (unit-tested; `bun test` green)

- `services/ledger-client/`: transport over JSON Ledger API v2. `getVersion`
  (live-verified: Canton 3.5.6) + `listParties` fully wired; `submitAndWait` /
  `queryActiveContracts` hit the confirmed v2 endpoints (the JsCommands / ACS body
  encoding is finalized against the OpenAPI spec with a live token).
  `auth.ts` does the Keycloak password grant with a clock-injected `TokenCache`.
- `features/epoch-scheduler/state-machine.ts`: the pure lifecycle state machine
  (`nextAction`), idempotent and keyed off observed on-ledger state.
- `features/epoch-scheduler/runner.ts`: the authoritative runner (`runOnce`) around
  the state machine; reads a snapshot, computes the next action, dispatches the
  matching ledger command via injected handlers. Unit-tested.
- `features/mm-simulator/decide.ts`: rational exercise (buy ITM / walk OTM) + the
  labeled demo premium quote. No market-priced numbers, no APY.
- `features/oracle-poller/price-source.ts`: BTC/USD spot fetch (Coinbase ->
  CoinGecko), Zod-parsed.
- `features/rest-api/`: `router.ts` (pure matcher) + `server.ts` (config-injected
  fetch handler + `Bun.serve`) + `gateway.ts` (REST intent -> JSON Ledger API v2).
  `/health` + `/version` (live) plus the ledger-backed routes (`/vault`,
  `/positions`, `/reports`, `/receipts`, `/deposit`, `/queue-withdraw`), all wired
  through the gateway and routed correctly (smoke-verified with a stub gateway).
  The caller's party is derived SERVER-SIDE from a `Bearer` token via a session map
  (`ServerConfig.sessions`), never from the request path/body, so a caller can only
  act as their own party; unauthenticated ledger requests get 401.
  Run via `bun run dev` (entrypoint `src/entrypoints/server.ts`).
- `services/ledger-client/commands.ts`: JsCommands / ACS request builders, shapes
  **verified against BitSafe's public api-collections** for this exact devnet
  (create/exercise/active-contracts + ledger-end), unit-tested.

The request path is complete. It goes live the moment `OIDC_USERNAME`/`OIDC_PASSWORD`
are set: the entrypoint then builds a `LedgerGateway` and the routes hit the real
ledger. Without creds they return 503. The one thing not exercised end-to-end here
is a real authenticated round-trip (needs the sponsor login).

## Modules (feature-based)

- `src/services/ledger-client/`: single wrapper over the JSON Ledger API. Submits
  commands, queries the ACS, streams transactions, wraps registry
  `AllocationFactory` calls. `Vault` is queried by template (its cid changes each
  epoch), never cached. All ledger traffic goes through here.
- `src/features/epoch-scheduler/`: singleton authoritative cron state machine.
  OpenDeposits -> LockCollateral -> WriteCall -> await PayPremium ->
  DistributePremium (one `PayoutPremium` per position: N transfers + N receipts)
  -> expiry -> Settle -> RecordEpoch -> roll. State transitions are idempotent,
  keyed off on-ledger `Vault` state, not wall-clock.
- `src/features/oracle-poller/`: polls public BTC spot (or Chainlink if 0.4 GO),
  writes `PriceObservation` on interval and at expiry.
- `src/features/mm-simulator/`: bot acting as `mm-buyer`. Accepts RFQ, pays premium
  on WriteCall, exercises rationally at expiry (buys ITM, walks OTM). Separate
  party/process, labeled SIMULATED.
- `src/features/rest-api/`: UI read endpoints (TVL, timeline, positions, reports,
  own receipts) + write endpoints (deposit, queue-withdraw, optional sweep-dust).
  No premium-claim endpoint: premium is pushed by the scheduler.

## Shared

- `src/utils/env.ts`: the single env boundary (Zod-validated at startup). Only file
  that reads `process.env`.
- `src/constants/errorIds.ts`: central error ID registry. Throw via
  `AppError(ErrorIds.X, '...', { context })`.
- `src/types/`, `src/schemas/`: shared types and Zod schemas.
- `src/entrypoints/`: process entrypoints (e.g. `server.ts`).

## Run

```bash
bun install          # from repo root
cp ../.env.example ../.env   # then fill in devnet endpoints
bun run dev          # from backend/
```
