// REST surface over the vault. The fetch handler is separated from the socket bind
// so it can be exercised with plain Request/Response objects in tests and smokes.
//
// `/health` and `/version` work standalone (version proxies the live JSON Ledger
// API). The ledger-backed read/write routes go through a LedgerGateway when one is
// configured (i.e. OIDC credentials are present); otherwise they return 503. The
// wiring is complete: supplying credentials is all that stands between 503 and live.

import { ErrorIds, isAppError } from '@/constants/errorIds'
import type { EngineControlHandle } from '@/features/epoch-scheduler/control'
import { getVersion } from '@/services/ledger-client/client'
import type { ActiveContract } from '@/services/ledger-client/parse'
import type { LedgerConfig } from '@/services/ledger-client/types'
import type { LedgerGateway } from './gateway'
import { filterCbtcHoldings, optionForEpoch } from './projections'
import { matchRoute, type RouteName } from './router'

export interface ServerConfig {
  port: number
  ledger?: LedgerConfig
  gateway?: LedgerGateway
  // Bearer-token -> party map. The caller's party is derived SERVER-SIDE from this,
  // never from the request path/body, so a caller can only ever act as their own
  // party. In production this is a real session store; for the demo it is a small
  // configured map. With no sessions configured, ledger routes reject with 401.
  sessions?: Record<string, string>
  // The operator session party, from the env boundary. GET /current-vault reads
  // the Vault with this identity, never the caller's, because a depositor is not
  // a Vault stakeholder (signatory operator only). With no operator party
  // configured, /current-vault 503s like the other ledger routes with no gateway.
  operatorParty?: string
  // The scheduler's engine control, threaded in the same way the ledger config is.
  // The scheduler runs as its own process today, so a server started without a
  // handle answers the /engine routes with 503 rather than pretending to control
  // an engine it cannot reach.
  engineControl?: EngineControlHandle
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// Resolve the caller's party from the Authorization: Bearer <token> header via the
// configured session map. Returns null if unauthenticated/unknown.
function callerParty(cfg: ServerConfig, req: Request): string | null {
  if (cfg.sessions === undefined) return null
  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (token === '') return null
  return cfg.sessions[token] ?? null
}

const LEDGER_PENDING = {
  error: 'ledger wiring pending',
  detail: 'set OIDC_USERNAME/OIDC_PASSWORD to enable ledger-backed routes',
}

async function handleVersion(cfg: ServerConfig): Promise<Response> {
  if (cfg.ledger === undefined) return json(LEDGER_PENDING, 503)
  const v = await getVersion(cfg.ledger)
  return json({ canton: v.version })
}

async function ledgerRead(
  cfg: ServerConfig,
  req: Request,
  module: string,
  template: string,
): Promise<Response> {
  if (cfg.gateway === undefined) return json(LEDGER_PENDING, 503)
  const party = callerParty(cfg, req)
  if (party === null) return json({ error: 'unauthenticated' }, 401)
  try {
    // Party is the authenticated caller's own party: they can only read their scope.
    const activeContracts = await cfg.gateway.activeContracts(party, module, template)
    return json({ party, template: `${module}:${template}`, activeContracts })
  } catch (e) {
    return json({ error: 'ledger query failed', detail: errMsg(e) }, 502)
  }
}

export interface CurrentVaultResponse {
  contractId: string
  epochNumber: unknown
  windowState: unknown
  strikePct: unknown
  cashInstrument: unknown
  expiry: unknown
  minDepositCbtc: unknown
}

// Pure mapper: the privacy boundary for GET /current-vault. Only these seven keys
// ever leave the process, no matter what the Vault/CallOption payloads carry
// (e.g. totalPooledCbtc, operator, oracleParty). Never widen this allowlist to
// include a depositor identity or a per-party figure; see router.test.ts for the
// regression guard.
//
// minDepositCbtc is on the allowlist because it is a vault rule, identical for every
// caller, and the depositor cannot honour a minimum they cannot read: without it the
// form let a sub-minimum amount through client validation and the deposit died at the
// ledger as an opaque HTTP 400. That is the opposite of a per-party figure.
export function currentVaultResponse(
  vault: ActiveContract,
  option: ActiveContract | undefined,
): CurrentVaultResponse {
  return {
    contractId: vault.contractId,
    epochNumber: vault.payload.epochNumber,
    windowState: vault.payload.windowState,
    strikePct: vault.payload.strikePct,
    cashInstrument: vault.payload.cashInstrument,
    expiry: option?.payload.expiry ?? null,
    minDepositCbtc: vault.payload.minDepositCbtc,
  }
}

async function handleCurrentVault(cfg: ServerConfig, req: Request): Promise<Response> {
  if (cfg.gateway === undefined || cfg.operatorParty === undefined) return json(LEDGER_PENDING, 503)
  // Presence gate only: the caller must carry SOME valid session token, matching
  // every other ledger route. This does not scope the read (see below); a caller
  // with any valid session sees the identical response, because the data is
  // public epoch params, not a depositor's own scope.
  if (callerParty(cfg, req) === null) return json({ error: 'unauthenticated' }, 401)
  try {
    // Read as the operator, not the caller: a depositor is not a Vault
    // stakeholder (signatory operator only), so a party-scoped read never sees it.
    const vaults = await cfg.gateway.activeContracts(cfg.operatorParty, 'Vault', 'Vault')
    const vault = vaults[0]
    if (vault === undefined) return json({ error: 'no active vault' }, 404)
    const options = await cfg.gateway.activeContracts(cfg.operatorParty, 'CallOption', 'CallOption')
    const option = optionForEpoch(options, vault.payload.epochNumber)
    return json(currentVaultResponse(vault, option))
  } catch (e) {
    return json({ error: 'ledger query failed', detail: errMsg(e) }, 502)
  }
}

export interface HoldingResponse {
  contractId: string
  amount: unknown
  instrument: unknown
}

function toHoldingResponse(h: ActiveContract): HoldingResponse {
  return { contractId: h.contractId, amount: h.payload.amount, instrument: h.payload.instrument }
}

async function handleHoldings(cfg: ServerConfig, req: Request): Promise<Response> {
  if (cfg.gateway === undefined) return json(LEDGER_PENDING, 503)
  const party = callerParty(cfg, req)
  if (party === null) return json({ error: 'unauthenticated' }, 401)
  try {
    // Party-scoped exactly like /positions: the caller can only ever read their
    // own holdings.
    const holdings = await cfg.gateway.activeContracts(party, 'Allocation', 'Holding')
    const cbtc = filterCbtcHoldings(holdings)
    return json(cbtc.map(toHoldingResponse))
  } catch (e) {
    return json({ error: 'ledger query failed', detail: errMsg(e) }, 502)
  }
}

async function handleDeposit(cfg: ServerConfig, req: Request): Promise<Response> {
  if (cfg.gateway === undefined) return json(LEDGER_PENDING, 503)
  const depositor = callerParty(cfg, req)
  if (depositor === null) return json({ error: 'unauthenticated' }, 401)
  const body = (await req.json()) as { vaultCid?: string; cbtcCid?: string; amountCbtc?: string }
  if (body.vaultCid === undefined || body.cbtcCid === undefined) {
    return json({ error: 'vaultCid, cbtcCid required' }, 400)
  }
  try {
    // The depositor is the caller, not a request field: nobody deposits as another.
    // With an amount, deposit exactly that much (splitting the holding, change back to
    // the depositor); without one, deposit the whole holding (back-compat).
    const result =
      body.amountCbtc === undefined
        ? await cfg.gateway.deposit(depositor, body.vaultCid, body.cbtcCid)
        : await cfg.gateway.depositAmount(depositor, body.vaultCid, body.cbtcCid, body.amountCbtc)
    return json({ ok: true, result })
  } catch (e) {
    return json({ error: 'deposit failed', detail: errMsg(e) }, 502)
  }
}

async function handleQueueWithdraw(cfg: ServerConfig, req: Request): Promise<Response> {
  if (cfg.gateway === undefined) return json(LEDGER_PENDING, 503)
  const party = callerParty(cfg, req)
  if (party === null) return json({ error: 'unauthenticated' }, 401)
  const body = (await req.json()) as { positionCid?: string }
  if (body.positionCid === undefined) {
    return json({ error: 'positionCid required' }, 400)
  }
  try {
    const result = await cfg.gateway.queueWithdraw(party, body.positionCid)
    return json({ ok: true, result })
  } catch (e) {
    return json({ error: 'queue-withdraw failed', detail: errMsg(e) }, 502)
  }
}

const ENGINE_PENDING = {
  error: 'engine control unavailable',
  detail: ErrorIds.SCHED_NO_CONTROL,
}

// The four /engine routes are operator-only. Every other route leans on the ledger to
// enforce scope, but pausing the scheduler is not a ledger read, so nothing downstream
// would stop a depositor from halting the vault. The check has to live here.
function handleEngine(cfg: ServerConfig, req: Request, route: RouteName): Response {
  const control = cfg.engineControl
  if (control === undefined) return json(ENGINE_PENDING, 503)
  const party = callerParty(cfg, req)
  if (party === null) return json({ error: 'unauthenticated' }, 401)
  if (cfg.operatorParty === undefined || party !== cfg.operatorParty) {
    return json({ error: 'operator only' }, 403)
  }
  // The control channel is a pair of files shared with the scheduler process, so a
  // mutation can fail on the filesystem rather than only in the domain. A pause that
  // did not reach the disk has not paused anything, and reporting the status back as
  // though it had would tell the operator the engine is halted while it keeps writing
  // calls. That is the one lie this panel must never tell.
  try {
    if (route === 'enginePause') control.pause()
    if (route === 'engineResume') control.resume()
    // Refused while running: the loop is dispatching on its own, and honoring a step
    // here would put two dispatchers on one vault. Refused rather than queued, so the
    // caller sees it instead of it landing silently on the next pause. requestStep runs
    // only for the step route (short-circuit), so pause/resume never trigger it.
    if (route === 'engineStep' && !control.requestStep()) {
      return json(
        { error: 'engine is running; pause before stepping', detail: ErrorIds.SCHED_NOT_PAUSED },
        409,
      )
    }
  } catch (e) {
    const detail = isAppError(e) ? e.toLogLine() : errMsg(e)
    return json({ error: 'engine control write failed', detail }, 500)
  }
  return json(control.status())
}

export function makeFetchHandler(cfg: ServerConfig): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url)
    const route: RouteName = matchRoute(req.method, url.pathname)
    switch (route) {
      case 'health':
        return json({ status: 'ok' })
      case 'version':
        return await handleVersion(cfg)
      case 'vault':
        return await ledgerRead(cfg, req, 'Vault', 'Vault')
      case 'option':
        return await ledgerRead(cfg, req, 'CallOption', 'CallOption')
      case 'positions':
        return await ledgerRead(cfg, req, 'VaultPosition', 'VaultPosition')
      case 'reports':
        return await ledgerRead(cfg, req, 'EpochReport', 'EpochReport')
      case 'receipts':
        return await ledgerRead(cfg, req, 'PremiumReceipt', 'PremiumReceipt')
      case 'currentVault':
        return await handleCurrentVault(cfg, req)
      case 'holdings':
        return await handleHoldings(cfg, req)
      case 'engine':
      case 'enginePause':
      case 'engineResume':
      case 'engineStep':
        return handleEngine(cfg, req, route)
      case 'deposit':
        return await handleDeposit(cfg, req)
      case 'queueWithdraw':
        return await handleQueueWithdraw(cfg, req)
      case 'notFound':
        return json({ error: 'not found' }, 404)
    }
  }
}

export function startServer(cfg: ServerConfig): { port: number; stop: () => void } {
  const handler = makeFetchHandler(cfg)
  const server = Bun.serve({ port: cfg.port, fetch: handler })
  return {
    // Bun types server.port as number | undefined; fall back to the port we asked for.
    port: server.port ?? cfg.port,
    stop: () => {
      void server.stop()
    },
  }
}
