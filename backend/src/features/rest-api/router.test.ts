import { describe, expect, test } from 'bun:test'
import { makeEngineControl } from '@/features/epoch-scheduler/control'
import type { ActiveContract } from '@/services/ledger-client/parse'
import { filterCbtcHoldings, optionForEpoch } from './projections'
import { isWrite, matchRoute } from './router'
import { currentVaultResponse, makeFetchHandler, type ServerConfig } from './server'

describe('matchRoute', () => {
  test('maps GET read endpoints', () => {
    expect(matchRoute('GET', '/health')).toBe('health')
    expect(matchRoute('GET', '/version')).toBe('version')
    expect(matchRoute('GET', '/vault')).toBe('vault')
    expect(matchRoute('GET', '/positions')).toBe('positions')
    expect(matchRoute('GET', '/reports')).toBe('reports')
    expect(matchRoute('GET', '/receipts')).toBe('receipts')
  })

  test('routes GET /current-vault', () => {
    expect(matchRoute('GET', '/current-vault')).toBe('currentVault')
  })

  test('routes GET /holdings', () => {
    expect(matchRoute('GET', '/holdings')).toBe('holdings')
  })

  test('maps POST write endpoints', () => {
    expect(matchRoute('POST', '/deposit')).toBe('deposit')
    expect(matchRoute('POST', '/queue-withdraw')).toBe('queueWithdraw')
  })

  test('tolerates a trailing slash', () => {
    expect(matchRoute('GET', '/vault/')).toBe('vault')
  })

  test('unknown paths and methods are notFound', () => {
    expect(matchRoute('GET', '/nope')).toBe('notFound')
    expect(matchRoute('POST', '/vault')).toBe('notFound')
    expect(matchRoute('DELETE', '/vault')).toBe('notFound')
  })

  test('routes the engine control surface', () => {
    expect(matchRoute('GET', '/engine')).toBe('engine')
    expect(matchRoute('POST', '/engine/pause')).toBe('enginePause')
    expect(matchRoute('POST', '/engine/resume')).toBe('engineResume')
    expect(matchRoute('POST', '/engine/step')).toBe('engineStep')
  })

  test('engine control is POST-only where it mutates', () => {
    // A GET that pauses the vault engine would be triggerable by a prefetch.
    expect(matchRoute('GET', '/engine/pause')).toBe('notFound')
    expect(matchRoute('GET', '/engine/step')).toBe('notFound')
  })

  test('there is no premium-claim endpoint (premium is pushed)', () => {
    expect(matchRoute('POST', '/claim-premium')).toBe('notFound')
    expect(matchRoute('GET', '/claim')).toBe('notFound')
  })
})

describe('isWrite', () => {
  test('classifies writes', () => {
    expect(isWrite('deposit')).toBe(true)
    expect(isWrite('queueWithdraw')).toBe(true)
    expect(isWrite('vault')).toBe(false)
    expect(isWrite('health')).toBe(false)
  })
})

describe('engine control routes', () => {
  const control = makeEngineControl(5000)
  const cfg: ServerConfig = {
    port: 0,
    operatorParty: 'operator',
    sessions: { 'op-token': 'operator', 'alice-token': 'alice' },
    engineControl: control,
  }
  const handler = makeFetchHandler(cfg)

  function call(method: string, path: string, token: string): Promise<Response> {
    return handler(
      new Request(`http://localhost${path}`, {
        method,
        headers: { authorization: `Bearer ${token}` },
      }),
    )
  }

  test('a depositor cannot pause the vault engine', async () => {
    // Nothing downstream would stop this: pausing the scheduler is not a ledger
    // read, so the ledger cannot enforce the scope the way it does elsewhere.
    const res = await call('POST', '/engine/pause', 'alice-token')
    expect(res.status).toBe(403)
    expect(control.status().paused).toBe(false)
  })

  test('an unauthenticated caller is rejected before touching the engine', async () => {
    const res = await handler(new Request('http://localhost/engine', { method: 'GET' }))
    expect(res.status).toBe(401)
  })

  test('stepping a running engine is refused with 409, not queued', async () => {
    const res = await call('POST', '/engine/step', 'op-token')
    expect(res.status).toBe(409)
    // A refusal that quietly became a pending step would fire on the next pause.
    control.pause()
    expect(control.consumeStep()).toBe(false)
    control.resume()
  })

  test('the operator can pause, step, and resume', async () => {
    expect((await call('POST', '/engine/pause', 'op-token')).status).toBe(200)
    expect(control.status().paused).toBe(true)

    const stepped = await call('POST', '/engine/step', 'op-token')
    expect(stepped.status).toBe(200)
    expect(control.consumeStep()).toBe(true)

    expect((await call('POST', '/engine/resume', 'op-token')).status).toBe(200)
    expect(control.status().paused).toBe(false)
  })

  test('GET /engine reports status without mutating it', async () => {
    const res = await call('GET', '/engine', 'op-token')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(control.status())
  })

  test('with no engine wired into the process, the routes 503 rather than pretend', async () => {
    const bare = makeFetchHandler({ port: 0, operatorParty: 'operator', sessions: {} })
    const res = await bare(new Request('http://localhost/engine', { method: 'GET' }))
    expect(res.status).toBe(503)
  })
})

describe('currentVaultResponse', () => {
  // The raw Vault/CallOption payloads carry far more than a depositor needs: the
  // depositor set never appears on these templates directly, but totalPooledCbtc
  // (a per-epoch aggregate) and party identifiers do. This is the regression
  // guard on the privacy boundary: only the allowlisted keys may ever leave.
  const vault: ActiveContract = {
    contractId: 'vault-cid-1',
    payload: {
      operator: 'operator::1220',
      oracleParty: 'oracle::1220',
      epochNumber: 3,
      windowState: 'Open',
      strikePct: 0.1,
      premiumSplitPct: 0.5,
      cashInstrument: 'mUSDC',
      maxObservationAge: 'PT1H',
      totalPooledCbtc: 12.5,
      minDepositCbtc: 0.01,
    },
  }
  const option: ActiveContract = {
    contractId: 'option-cid-1',
    payload: {
      operator: 'operator::1220',
      mmBuyer: 'mm::1220',
      epochNumber: 3,
      expiry: '2026-07-17T00:00:00Z',
      state: 'Written',
    },
  }

  test('current-vault response exposes no depositor identity or per-party figure', () => {
    const shape = currentVaultResponse(vault, option)
    const keys = Object.keys(shape)
    expect(keys).toEqual([
      'contractId',
      'epochNumber',
      'windowState',
      'strikePct',
      'cashInstrument',
      'expiry',
      // A vault-wide rule, identical for every caller, so it is not a per-party
      // figure. The depositor form needs it to reject a sub-minimum amount before
      // submitting rather than after the ledger rejects it.
      'minDepositCbtc',
    ])
    expect(keys).not.toContain('depositor')
    expect(keys).not.toContain('depositors')
    expect(keys).not.toContain('positions')
    expect(keys).not.toContain('totalPooledCbtc')
  })

  test('carries the epoch params and current cid through', () => {
    expect(currentVaultResponse(vault, option)).toEqual({
      contractId: 'vault-cid-1',
      epochNumber: 3,
      windowState: 'Open',
      strikePct: 0.1,
      cashInstrument: 'mUSDC',
      expiry: '2026-07-17T00:00:00Z',
      minDepositCbtc: 0.01,
    })
  })

  test('expiry is null when no CallOption has been written yet for this epoch', () => {
    expect(currentVaultResponse(vault, undefined)).toEqual({
      contractId: 'vault-cid-1',
      epochNumber: 3,
      windowState: 'Open',
      strikePct: 0.1,
      cashInstrument: 'mUSDC',
      expiry: null,
      minDepositCbtc: 0.01,
    })
  })
})

describe('filterCbtcHoldings', () => {
  // GET /holdings must never surface a non-CBTC instrument on this template.
  const musdc: ActiveContract = {
    contractId: 'holding-musdc-1',
    payload: { amount: 250, instrument: 'mUSDC' },
  }
  const cbtc: ActiveContract = {
    contractId: 'holding-cbtc-1',
    payload: { amount: 0.5, instrument: 'CBTC' },
  }

  test('keeps only the CBTC holding', () => {
    expect(filterCbtcHoldings([musdc, cbtc])).toEqual([cbtc])
  })

  test('returns an empty list when nothing is CBTC', () => {
    expect(filterCbtcHoldings([musdc])).toEqual([])
  })
})

describe('optionForEpoch', () => {
  // GET /current-vault joins on this: the option written for the epoch the Vault
  // is currently in, not the newest option overall.
  const optionEpoch1: ActiveContract = {
    contractId: 'option-cid-epoch-1',
    payload: { epochNumber: 1, expiry: '2026-07-10T00:00:00Z' },
  }
  const optionEpoch2: ActiveContract = {
    contractId: 'option-cid-epoch-2',
    payload: { epochNumber: 2, expiry: '2026-07-17T00:00:00Z' },
  }

  test('returns the option whose epochNumber matches the current epoch', () => {
    const match = optionForEpoch([optionEpoch1, optionEpoch2], 2)
    expect(match?.payload.expiry).toBe('2026-07-17T00:00:00Z')
  })

  test('returns undefined when no option has been written for the current epoch yet', () => {
    expect(optionForEpoch([optionEpoch1], 2)).toBeUndefined()
  })
})
