// Central error ID registry. See guides/error-id-registry.md.
//
// Rules:
//   1. Never reuse a retired ID - mark it `// retired` and leave it in place.
//   2. One ID per distinct cause, not per throw site.
//   3. Numbers are stable; append, never renumber.
//   4. Domain prefix (3–5 letters) is required.
//
// Throw via AppError(ErrorIds.X, '...', { context }). Log lines include the ID
// so grep, telemetry, and agents can all find every occurrence with one search.

export const ErrorIds = {
  // ── Config (CFG) ─────────────────────────────────────────────────────────
  CFG_MISSING: 'E_CFG_001',
  CFG_INVALID_JSON: 'E_CFG_002',
  CFG_SCHEMA_FAIL: 'E_CFG_003',
  CFG_ENV_MISSING: 'E_CFG_004',

  // ── Filesystem (FS) ──────────────────────────────────────────────────────
  FS_NOT_FOUND: 'E_FS_001',
  FS_PERMISSION: 'E_FS_002',
  FS_DISK_FULL: 'E_FS_003',
  FS_READ_FAIL: 'E_FS_004',
  FS_WRITE_FAIL: 'E_FS_005',

  // ── Network (NET) ────────────────────────────────────────────────────────
  NET_TIMEOUT: 'E_NET_001',
  NET_DNS: 'E_NET_002',
  NET_TLS: 'E_NET_003',
  NET_RATE_LIMITED: 'E_NET_004',
  NET_UNAVAILABLE: 'E_NET_005',
  NET_BAD_SHAPE: 'E_NET_006',

  // ── Tool execution (TOOL) ────────────────────────────────────────────────
  TOOL_ABORTED: 'E_TOOL_001',
  TOOL_BAD_INPUT: 'E_TOOL_002',
  TOOL_TIMEOUT: 'E_TOOL_003',
  TOOL_PERMISSION_DENIED: 'E_TOOL_004',
  TOOL_SECURITY_BLOCKED: 'E_TOOL_005',

  // ── Ledger / JSON Ledger API (LGR) ─────────────────────────────────────────
  LGR_SUBMIT_FAIL: 'E_LGR_001',
  LGR_QUERY_FAIL: 'E_LGR_002',
  LGR_CONTRACT_NOT_FOUND: 'E_LGR_003',
  LGR_STALE_CID: 'E_LGR_004',
  LGR_AUTH_FAIL: 'E_LGR_005',

  // ── CIP-56 allocation / collateral (ALLOC) ─────────────────────────────────
  ALLOC_CREATE_FAIL: 'E_ALLOC_001',
  ALLOC_EXECUTE_FAIL: 'E_ALLOC_002',
  ALLOC_WITHDRAW_FAIL: 'E_ALLOC_003',
  ALLOC_WINDOW_EXPIRED: 'E_ALLOC_004',

  // ── Oracle / price observation (ORCL) ──────────────────────────────────────
  ORCL_FETCH_FAIL: 'E_ORCL_001',
  ORCL_STALE_OBSERVATION: 'E_ORCL_002',
  ORCL_WRONG_EPOCH: 'E_ORCL_003',

  // ── Epoch lifecycle (EPOCH) ────────────────────────────────────────────────
  EPOCH_WINDOW_CLOSED: 'E_EPOCH_001',
  EPOCH_INVALID_TRANSITION: 'E_EPOCH_002',
  EPOCH_SETTLE_GUARD_FAIL: 'E_EPOCH_003',

  // ── Faucet (FCT) ───────────────────────────────────────────────────────────
  FCT_REQUEST_FAIL: 'E_FCT_001',
  FCT_LIMIT_EXCEEDED: 'E_FCT_002',

  // ── Registry HTTP / choice context (REG) ───────────────────────────────────
  REG_CHOICE_CONTEXT_FAIL: 'E_REG_001',
  REG_CHOICE_CONTEXT_MALFORMED: 'E_REG_002',

  // ── Decimal / premium split (DEC) ───────────────────────────────────────────
  DEC_ZERO_WEIGHT_SPLIT: 'E_DEC_001',
  DEC_PREMIUM_TOO_SMALL: 'E_DEC_002',

  // ── Scheduler / engine wiring (SCHED) ──────────────────────────────────────
  SCHED_NO_POOL: 'E_SCHED_001',
  SCHED_NO_PRICE: 'E_SCHED_002',
  SCHED_NO_ALLOCATION: 'E_SCHED_003',
  SCHED_NO_PREMIUM_HOLDING: 'E_SCHED_004',
  SCHED_NOT_PAUSED: 'E_SCHED_005', // a manual step was requested while the loop is running
  SCHED_NO_CONTROL: 'E_SCHED_006', // no engine control handle wired into this process
  SCHED_CONTROL_UNREADABLE: 'E_SCHED_007', // an engine control file exists but will not parse
  SCHED_POOL_MERGE_EMPTY: 'E_SCHED_008', // consolidating the CBTC pool returned no holding

  // ── Market-maker simulator (MM) ────────────────────────────────────────────
  MM_NO_FUNDS: 'E_MM_001',
  MM_NO_OPTION: 'E_MM_002',

  // ── Deposit (DEP) ──────────────────────────────────────────────────────────
  DEP_BAD_AMOUNT: 'E_DEP_001', // amount non-positive, or above the holding balance
  DEP_HOLDING_NOT_FOUND: 'E_DEP_002', // cid not among the caller's own holdings
  DEP_SPLIT_FAILED: 'E_DEP_003', // Split committed but produced no depositable chunk
  // E_DEP_004 (DEP_EPOCH_ROLLING) retired: the M3 deposit-window race it guarded is now
  // closed in Daml (RecordEpoch leaves the window Locked, RollPositions reopens it),
  // vetted on devnet as overwrite-vault 1.1.0 (bffa00c2). The id is not reused.
  // E_DEP_005 (DEP_POSITION_EXISTS) was drafted for a second position in one epoch and
  // never shipped: overwrite-vault 1.2.0 makes Deposit top up the existing position
  // instead, so there is nothing left to refuse. The id is not reused.

  // Add new domains/IDs below. Keep the comment block above each domain.
} as const

export type ErrorId = (typeof ErrorIds)[keyof typeof ErrorIds]

export class AppError extends Error {
  readonly id: ErrorId
  readonly context: Record<string, unknown>

  constructor(id: ErrorId, message: string, context: Record<string, unknown> = {}) {
    super(message)
    this.id = id
    this.context = context
    this.name = 'AppError'
  }

  toLogLine(): string {
    const ctx = Object.entries(this.context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(' ')
    return `[${this.id}] ${this.message}${ctx ? ` ${ctx}` : ''}`
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError
}
