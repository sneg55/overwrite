// Single env boundary. See guides/zod-at-the-boundary.md.
//
// Rules:
//   1. This file is the ONLY place `process.env` is read.
//     (The ESLint config enforces this via no-restricted-properties.)
//   2. The schema is the source of truth for the `Env` type.
//   3. `envSchema.parse` runs on the FIRST field access, not at import. The app still
//      fails fast (the entrypoint reads env at startup), but a unit test can import an
//      env-consuming module without a sourced `.env`, as long as it never reads a field.
//   4. Add new vars here, declare their shape, provide a default where sensible.
//
// Consumers:
//   import { env } from '@/env'
//   fetch(env.API_URL, { signal })

import { z } from 'zod'

export const envSchema = z.object({
  // ── Runtime ──────────────────────────────────────────────────────────────
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // ── Canton / JSON Ledger API (HackCanton devnet; Canton 3.5.6) ─────────────
  LEDGER_API_URL: z.string().url(),
  LEDGER_API_GRPC: z.string().min(1).optional(),
  VALIDATOR_API_URL: z.string().url().optional(),
  AUDIENCE: z.string().url().optional(),

  // ── DA Registry + CBTC (from cbtc-lib devnet config) ───────────────────────
  REGISTRY_URL: z.string().url(),
  CBTC_NETWORK_PARTY: z.string().min(1),
  BITSAFE_API_URL: z.string().url().optional(),

  // ── Keycloak / OIDC (password grant; secrets are runtime-supplied) ─────────
  OIDC_TOKEN_URL: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().min(1).optional(),
  // Keycloak on this devnet rejects `offline_access` with invalid_scope for the
  // password grant; the ledger API only needs `openid daml_ledger_api`.
  OIDC_SCOPE: z.string().min(1).default('openid daml_ledger_api'),
  OIDC_USERNAME: z.string().min(1).optional(),
  OIDC_PASSWORD: z.string().min(1).optional(),

  // ── REST session map (demo): "token=party,token=party" ────────────────────
  // Binds a caller's bearer token to exactly one party server-side. Without it,
  // ledger-backed REST routes reject with 401 (secure default). Production
  // replaces this with a real identity provider / session store.
  SESSIONS: z.string().optional(),

  // ── Local sandbox mode ─────────────────────────────────────────────────────
  // LEDGER_LOCAL=true builds a no-auth gateway (empty bearer + SANDBOX_USER_ID in
  // command bodies) against a local `daml sandbox`, bypassing OIDC. Set by
  // scripts/seed-demo's .sandbox/demo.env; never on devnet.
  LEDGER_LOCAL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SANDBOX_USER_ID: z.string().min(1).default('participant_admin'),

  // ── CBTC faucet (devnet; plain JSON API, no auth) ──────────────────────────
  // Per-network subdomain (moved 2026-07-13). The apex cbtc-faucet.bitsafe.finance
  // serves the UI but its /api is dead; the live API is on the devnet subdomain.
  FAUCET_URL: z.string().url().default('https://cbtc-faucet.devnet.bitsafe.finance'),
  FAUCET_NETWORK: z.enum(['devnet', 'testnet']).default('devnet'),

  // ── Demo parties (backend-owned, labeled custodial) ────────────────────────
  OPERATOR_PARTY: z.string().min(1),
  ORACLE_PARTY: z.string().min(1),
  MM_BUYER_PARTY: z.string().min(1),

  // ── Oracle price source (public BTC spot API; Chainlink if 0.4 GO) ─────────
  PRICE_API_URL: z.string().url().optional(),

  // ── Epoch engine (compressed demo clock; parameterized, never a literal) ────
  EPOCH_LENGTH_MS: z.coerce.number().int().positive().default(20_000),
  DEPOSIT_WINDOW_MS: z.coerce.number().int().nonnegative().default(0),
  TICK_MS: z.coerce.number().int().positive().default(2_000),
  ORACLE_POLL_MS: z.coerce.number().int().positive().default(3_000),
  PREMIUM_BPS: z.coerce.number().int().positive().default(100),
  STRIKE_PCT: z.coerce.number().positive().default(0.1),
  CASH_INSTRUMENT: z.string().min(1).default('mUSDC'),
  // The collateral allocation window LockCollateral now takes as choice arguments,
  // because the registry's off-ledger choice context is fetched for the exact
  // arguments a submission carries. ALLOCATE_WINDOW_MS is how long
  // the registry has to accept the allocation; SETTLE_BUFFER_MS is the slack past
  // that for settlement, and it must be at least the vault's own
  // settleBufferSeconds or LockCollateral rejects the submission. The seed scripts
  // create vaults with a 1 hour buffer, so this default matches them.
  ALLOCATE_WINDOW_MS: z.coerce.number().int().positive().default(86_400_000),
  SETTLE_BUFFER_MS: z.coerce.number().int().positive().default(3_600_000),
  // Wire the lock and ITM-settle legs to the REAL CBTC registry: fetch each
  // allocation choice context off-ledger and attach the registry's disclosed
  // contracts to the submission. Default false keeps the local sandbox running
  // against the labeled MockAllocationFactory.
  USE_REAL_REGISTRY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  // Labeled demo override: when set, the oracle publishes this fixed price with
  // isDemo=true (the "open" price of a demo epoch). Unset for the unattended run.
  ORACLE_DEMO_PRICE: z.string().min(1).optional(),
  // Optional demo price step: after ORACLE_DEMO_SWITCH_MS have elapsed since a
  // process started, the oracle observes and the MM decides from this "late" price
  // instead of the base. A base -> late step above the strike is what forces one demo
  // epoch to settle ITM deterministically (a constant demo price is always OTM,
  // because strike = base * (1 + STRIKE_PCT)). Both must be set for the step to apply.
  ORACLE_DEMO_PRICE_LATE: z.string().min(1).optional(),
  ORACLE_DEMO_SWITCH_MS: z.coerce.number().int().nonnegative().optional(),

  // ── Engine control channel (operator pause / step) ─────────────────────────
  // The scheduler and the REST server are separate OS processes (sandbox.sh runs
  // `serve` and `engine` independently), so the operator's pause cannot be an object
  // in one heap. It is two JSON files in this directory instead, one writer each.
  // Both processes are launched with backend/ as their working directory, so the
  // default resolves to the same repo-root .sandbox that sandbox.sh already keeps its
  // state in. The only property that matters is that both sides agree, so override
  // this in tandem or not at all.
  ENGINE_CONTROL_DIR: z.string().min(1).default('../.sandbox'),
}) satisfies z.ZodType

export type Env = z.infer<typeof envSchema>

function loadEnv(): Env {
  // Treat an empty-string env var as unset: an optional field left blank in .env
  // (e.g. `PRICE_API_URL=`) should use its default / stay undefined, not fail
  // `.url()` on "". An unset var and a blank var mean the same thing here.
  // eslint-disable-next-line no-restricted-properties -- this file is the env boundary.
  const raw = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ''))
  const parsed = envSchema.safeParse(raw)
  if (!parsed.success) {
    // Render a readable error at startup. One bad env var should surface the
    // exact field and reason, not crash 10 stack frames deep.
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    console.error(`[env] invalid configuration:\n${lines.join('\n')}`)
    process.exit(1)
  }
  return parsed.data
}

let cached: Env | undefined
function getEnv(): Env {
  cached ??= loadEnv()
  return cached
}

// Lazy: parsing (and the fail-fast exit) is deferred to the first field read, so merely
// importing a module that imports `env` costs nothing until a value is actually needed.
export const env: Env = new Proxy({} as Env, {
  get: (_t, prop) => getEnv()[prop as keyof Env],
  has: (_t, prop) => prop in getEnv(),
  ownKeys: () => Reflect.ownKeys(getEnv()),
  getOwnPropertyDescriptor: (_t, prop) => Object.getOwnPropertyDescriptor(getEnv(), prop),
})
