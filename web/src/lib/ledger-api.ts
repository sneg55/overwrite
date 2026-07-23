// Server-only. Reads party-scoped active contracts from the local REST backend,
// acting AS the given party via its demo bearer token (`demo-<name>`, which the
// backend's SESSIONS map binds to the real party id). This is what makes the
// privacy reveal real: the empty observer view is produced by the ledger's own ACS
// scoping, fetched on the server, not filtered in the browser.
//
// An unreachable backend is NOT an empty ACS. Returning [] on failure would make the
// UI say "the ledger returns nothing for this party", which is a privacy claim we
// have not observed. So this returns a discriminated result and the screens render a
// distinct "cannot reach the ledger" state.
import type { Party } from './parties'

const API = process.env.OVERWRITE_API_URL ?? 'http://localhost:3001'

export interface LedgerContract {
  contractId: string
  payload: Record<string, unknown>
}

interface RestReadResponse {
  activeContracts?: LedgerContract[]
}

export type LedgerResult<T> = { ok: true; data: T } | { ok: false; error: string }

export function mapResult<A, B>(r: LedgerResult<A>, f: (a: A) => B): LedgerResult<B> {
  return r.ok ? { ok: true, data: f(r.data) } : r
}

export async function readAs(party: Party, route: string): Promise<LedgerResult<LedgerContract[]>> {
  try {
    const res = await fetch(`${API}/${route}`, {
      headers: { authorization: `Bearer demo-${party}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: false, error: `ledger backend responded ${res.status}` }
    }
    const body = (await res.json()) as RestReadResponse
    return { ok: true, data: body.activeContracts ?? [] }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[ledger-api] readAs(${party}, ${route}) failed:`, error)
    return { ok: false, error: 'cannot reach the ledger backend' }
  }
}

// The /holdings route is a party-scoped projection, not an ACS query: it returns a
// bare array of { contractId, amount, instrument } rather than the { activeContracts }
// envelope readAs expects, so it gets its own reader. Same bearer scoping as readAs,
// so a caller only ever sees the CBTC holdings it owns. An unreachable backend stays
// a distinct error, never an empty wallet (which would read as a false "0 balance").
export interface RawHolding {
  contractId: string
  amount: unknown
  instrument: unknown
}

export async function readHoldingsAs(party: Party): Promise<LedgerResult<RawHolding[]>> {
  try {
    const res = await fetch(`${API}/holdings`, {
      headers: { authorization: `Bearer demo-${party}` },
      cache: 'no-store',
    })
    if (!res.ok) {
      return { ok: false, error: `ledger backend responded ${res.status}` }
    }
    const body = (await res.json()) as unknown
    return { ok: true, data: Array.isArray(body) ? (body as RawHolding[]) : [] }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[ledger-api] readHoldingsAs(${party}) failed:`, error)
    return { ok: false, error: 'cannot reach the ledger backend' }
  }
}

// The active vault, resolved live from the backend right before a deposit. A Vault is
// operator-signatory (a depositor cannot read it party-scoped), and Vault.Deposit is
// consuming, so the cid rotates every epoch AND every deposit: a cached or env-pinned
// cid goes stale after one write. The backend reads it as the operator and exposes only
// public epoch params (never a depositor's book). windowState gates whether the deposit
// window is open. A 404 (no vault) is kept distinct from an outage.
export interface CurrentVault {
  contractId: string
  windowState: string
  epochNumber: number
  /**
   * The vault's minimum deposit. Carried as the raw decimal string, never a number:
   * this is a money amount and the deposit path is string-exact end to end (the form
   * posts a string, the backend forwards a string, Daml parses a Decimal). Comparing
   * it needs a decimal compare, not a float compare.
   */
  minDepositCbtc: string
}

export async function readCurrentVault(party: Party): Promise<LedgerResult<CurrentVault>> {
  try {
    const res = await fetch(`${API}/current-vault`, {
      headers: { authorization: `Bearer demo-${party}` },
      cache: 'no-store',
    })
    if (res.status === 404) return { ok: false, error: 'no active vault' }
    if (!res.ok) return { ok: false, error: `ledger backend responded ${res.status}` }
    const body = (await res.json()) as {
      contractId?: unknown
      windowState?: unknown
      epochNumber?: unknown
      minDepositCbtc?: unknown
    }
    if (typeof body.contractId !== 'string' || body.contractId === '') {
      return { ok: false, error: 'current vault response missing a contract id' }
    }
    return {
      ok: true,
      data: {
        contractId: body.contractId,
        windowState: String(body.windowState ?? ''),
        epochNumber: Number(body.epochNumber ?? 0),
        // An absent minimum reads as '0', i.e. no floor, rather than a guessed one.
        // A wrong non-zero floor would block deposits the ledger would have accepted.
        minDepositCbtc: typeof body.minDepositCbtc === 'string' ? body.minDepositCbtc : '0',
      },
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[ledger-api] readCurrentVault(${party}) failed:`, error)
    return { ok: false, error: 'cannot reach the ledger backend' }
  }
}

// The scheduler's own status, which is not a ledger read at all: it is the engine
// process reporting on itself through a control channel the backend shares with it.
// Kept alongside the ledger readers because it travels the same authenticated transport
// and carries the same distinction, an outage being different from an answer.
//
// Every field is nullable on purpose. The scheduler is a separate process, so "the
// engine has not ticked yet" is a real state the operator will meet, and it must not be
// mistaken for a value.
export interface EngineStatus {
  paused: boolean
  nextAction: string | null
  lastAction: string | null
  lastDispatchedAt: string | null
  lastTickAt: string | null
  lastError: string | null
  tickMs: number
}

// The query-string key an engine control action uses to report a click that never
// landed. It lives here rather than in engine-actions because a `'use server'` module
// may export nothing but async functions: a lone constant there invalidates every
// export in the file, and the build fails on the actions rather than on the constant.
export const ENGINE_ERROR_PARAM = 'engineError'

const nullableString = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

export async function readEngineStatus(party: Party): Promise<LedgerResult<EngineStatus>> {
  try {
    const res = await fetch(`${API}/engine`, {
      headers: { authorization: `Bearer demo-${party}` },
      cache: 'no-store',
    })
    // A non-operator gets 403 here. That is a correct answer rather than a fault, but the
    // panel is gated on the role anyway, so it never reaches this path in practice.
    if (!res.ok) return { ok: false, error: `engine control responded ${res.status}` }
    const body = (await res.json()) as Record<string, unknown>
    return {
      ok: true,
      data: {
        paused: body.paused === true,
        nextAction: nullableString(body.nextAction),
        lastAction: nullableString(body.lastAction),
        lastDispatchedAt: nullableString(body.lastDispatchedAt),
        lastTickAt: nullableString(body.lastTickAt),
        lastError: nullableString(body.lastError),
        tickMs: typeof body.tickMs === 'number' ? body.tickMs : 0,
      },
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[ledger-api] readEngineStatus(${party}) failed:`, error)
    return { ok: false, error: 'cannot reach the ledger backend' }
  }
}

// Server-only write transport. Posts an intent to the REST backend AS the acting
// party (its demo bearer). The backend derives the acting party from this token
// server-side, so the browser can never submit as a party other than its own session.
// A non-2xx carries the backend's own detail (e.g. "window not Open"); an unreachable
// backend is reported distinctly, never as a silent no-op.
export async function writeAs(party: Party, route: string, body: unknown): Promise<LedgerResult<unknown>> {
  try {
    const res = await fetch(`${API}/${route}`, {
      method: 'POST',
      headers: { authorization: `Bearer demo-${party}`, 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify(body),
    })
    const payload = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
    if (!res.ok) {
      return { ok: false, error: payload.detail ?? payload.error ?? `ledger backend responded ${res.status}` }
    }
    return { ok: true, data: payload }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e)
    console.error(`[ledger-api] writeAs(${party}, ${route}) failed:`, error)
    return { ok: false, error: 'cannot reach the ledger backend' }
  }
}
