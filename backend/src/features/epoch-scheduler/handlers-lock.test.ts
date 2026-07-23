// Lock-path handler tests: the settlement window LockCollateral now takes as choice
// arguments, and the mock-versus-registry mode switch. Split from handlers.test.ts.

import { describe, expect, test } from 'bun:test'
import { type HandlerCtx, writeCall } from './handlers'
import { baseReads, cfg, recorder } from './handlers-fixtures'
import { lockCollateral } from './handlers-lock'
import type { TickReads } from './reads'

describe('lockCollateral', () => {
  test('throws SCHED_NO_POOL when there is no pool holding', async () => {
    const rec = recorder()
    const ctx = { session: rec.session, reads: baseReads, cfg } as unknown as HandlerCtx
    let error: unknown
    try {
      await lockCollateral(ctx)
    } catch (caught) {
      error = caught
    }
    expect(String(error)).toContain('E_SCHED_001')
  })

  test('throws SCHED_NO_ALLOCATION when there is no AllocationFactory', async () => {
    const rec = recorder()
    const reads: TickReads = { ...baseReads, poolHoldingCid: '00pool', poolAmount: '3.0' }
    const ctx = { session: rec.session, reads, cfg } as unknown as HandlerCtx
    let error: unknown
    try {
      await lockCollateral(ctx)
    } catch (caught) {
      error = caught
    }
    expect(String(error)).toContain('E_SCHED_003')
  })

  test('passes the pool holding, factory cid, empty choice context, and bakes the mmBuyer into the allocation', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00pool',
      poolAmount: '3.0',
      factoryCid: '00factory',
    }
    const ctx = { session: rec.session, reads, cfg } as unknown as HandlerCtx
    await lockCollateral(ctx)
    const call = rec.calls.find((c) => c.choice === 'LockCollateral')
    // The settlement window is now a choice argument, derived from the tick's `now`
    // (1_000) plus the configured allocate window and settle buffer. Daml re-checks
    // these bounds; see assertValidAllocationWindow.
    expect(call?.choiceArgument).toEqual({
      cbtcPoolCid: '00pool',
      mmBuyer: 'mm',
      factoryCid: '00factory',
      allocContext: { context: { values: {} }, meta: { values: {} } },
      requestedAt: new Date(1_000).toISOString(),
      allocateBefore: new Date(1_000 + cfg.allocateWindowMs).toISOString(),
      // The epoch length is folded in so settleBefore outlasts the option expiry
      // (writeTime + epochLengthMs), which is set later at WriteCall.
      settleBefore: new Date(
        1_000 + cfg.allocateWindowMs + cfg.epochLengthMs + cfg.settleBufferMs,
      ).toISOString(),
    })
    expect(call?.actAs).toEqual(['operator'])
  })

  test('mock mode attaches no disclosed contracts and never calls the registry', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00pool',
      poolAmount: '3.0',
      factoryCid: '00factory',
    }
    // A session whose token() would throw proves mock mode never reaches for auth,
    // which it only needs in order to fetch a registry choice context.
    const session = {
      ...rec.session,
      token: () => {
        throw new Error('mock mode must not authenticate a registry fetch')
      },
    }
    await lockCollateral({ session, reads, cfg } as unknown as HandlerCtx)
    const call = rec.calls.find((c) => c.choice === 'LockCollateral')
    expect(call?.disclosed).toBeUndefined()
    expect(call?.choiceArgument.factoryCid).toBe('00factory')
  })
})

describe('lockCollateral in registry mode', () => {
  const registryCfg = { ...cfg, useRealRegistry: true }
  const reads: TickReads = {
    ...baseReads,
    poolHoldingCid: '00pool',
    poolAmount: '3.0',
    factoryCid: '00mockfactory',
  }
  const disclosed = [
    {
      templateId: 'reg:Factory',
      contractId: '00disclosed',
      createdEventBlob: 'blob',
      synchronizerId: 'sync',
    },
  ]
  function stubRegistry(): { port: { factoryContext: unknown }; seen: unknown[] } {
    const seen: unknown[] = []
    return {
      seen,
      port: {
        factoryContext: (
          _url: string,
          _registrar: string,
          _token: string,
          choiceArguments: unknown,
        ) => {
          seen.push(choiceArguments)
          return Promise.resolve({
            factoryId: '00realfactory',
            context: { contextValues: { key: 'value' }, disclosedContracts: disclosed },
            disclosed,
          })
        },
      },
    }
  }

  test('fetches the context for the exact arguments Daml will submit', async () => {
    const rec = recorder()
    const stub = stubRegistry()
    const session = { ...rec.session, token: () => Promise.resolve('tok') }
    await lockCollateral({
      session,
      reads,
      cfg: registryCfg,
      registry: stub.port,
    } as unknown as HandlerCtx)

    // The fetched context is only valid for these exact choice arguments, so this
    // must mirror what Daml's collateralSpec builds: receiver is the mmBuyer, amount
    // is the pool, admin is the registrar, and the window is the one submitted.
    // Real mode exercises LockCollateralReal (interface-typed pool), not LockCollateral.
    const call = rec.calls.find((c) => c.choice === 'LockCollateralReal')
    expect(call).toBeDefined()
    expect(stub.seen).toHaveLength(1)
    expect(stub.seen[0]).toEqual({
      expectedAdmin: 'registrar',
      allocation: {
        settlement: {
          executor: 'operator',
          settlementRef: { id: 'overwrite-collateral', cid: null },
          requestedAt: call?.choiceArgument.requestedAt,
          allocateBefore: call?.choiceArgument.allocateBefore,
          settleBefore: call?.choiceArgument.settleBefore,
          meta: { values: {} },
        },
        transferLegId: 'collateral',
        transferLeg: {
          sender: 'operator',
          receiver: 'mm',
          amount: '3.0',
          instrumentId: { admin: 'registrar', id: 'CBTC' },
          meta: { values: {} },
        },
      },
      requestedAt: call?.choiceArgument.requestedAt,
      inputHoldingCids: ['00pool'],
      extraArgs: { context: { values: {} }, meta: { values: {} } },
    })
  })

  test('submits against the registry factory with its context and disclosed contracts', async () => {
    const rec = recorder()
    const stub = stubRegistry()
    const session = { ...rec.session, token: () => Promise.resolve('tok') }
    await lockCollateral({
      session,
      reads,
      cfg: registryCfg,
      registry: stub.port,
    } as unknown as HandlerCtx)

    const call = rec.calls.find((c) => c.choice === 'LockCollateralReal')
    expect(call).toBeDefined()
    // The registry's own factory cid wins over the local mock one read off the ledger.
    expect(call?.choiceArgument.factoryCid).toBe('00realfactory')
    expect(call?.choiceArgument.allocContext).toEqual({
      context: { values: { key: 'value' } },
      meta: { values: {} },
    })
    expect(call?.disclosed).toEqual(disclosed)
  })
})

describe('the collateral settlement window versus option expiry', () => {
  // M2 regression. The option's expiry is writeTime + epochLengthMs, set later at
  // WriteCall; the collateral's settleBefore is set here at lock time. If the settle
  // window closes first, the collateral is withdrawable while the call is still live:
  // the buyer holds an option that cannot be delivered against, having already paid a
  // premium it cannot recover. No on-ledger guard catches this (Daml only relates
  // settleBefore to allocateBefore) and the local mock allocation ignores both
  // windows, so the Daml suite cannot see it either. This test is the only thing
  // standing between that config and production.
  async function settleWindowFor(epochLengthMs: number): Promise<number> {
    const rec = recorder()
    await lockCollateral({
      session: rec.session,
      reads: { ...baseReads, poolHoldingCid: '00pool', poolAmount: '3.0', factoryCid: '00f' },
      cfg: { ...cfg, epochLengthMs },
    } as unknown as HandlerCtx)
    const call = rec.calls.find((c) => c.choice === 'LockCollateral')
    return Date.parse(String(call?.choiceArgument.settleBefore))
  }

  test.each([
    ['20s demo epoch', 20_000],
    ['1 hour', 3_600_000],
    ['1 day', 86_400_000],
    ['1 week, the product cadence', 604_800_000],
    ['4 weeks', 2_419_200_000],
  ])('settleBefore outlasts a %s option expiry', async (_label, epochLengthMs) => {
    const settleBefore = await settleWindowFor(epochLengthMs)
    // Worst case the write lands in the same tick as the lock, so expiry is at the
    // earliest baseReads.now + epochLengthMs. settleBefore must be strictly later.
    const earliestExpiry = 1_000 + epochLengthMs
    expect(settleBefore).toBeGreaterThan(earliestExpiry)
  })

  test('a weekly epoch does not close the settle window before expiry', async () => {
    // The specific case that was broken: a 1 week epoch against the 24h allocate
    // window. Deriving settleBefore from the allocate window alone put it roughly six
    // days BEFORE expiry.
    const weekMs = 604_800_000
    const settleBefore = await settleWindowFor(weekMs)
    const expiry = 1_000 + weekMs
    expect(settleBefore - expiry).toBeGreaterThanOrEqual(cfg.settleBufferMs)
  })
})

describe('WriteCall command id', () => {
  // M1 regression. WriteCall is the only NONCONSUMING lifecycle choice, so a retry
  // after a lost response creates a SECOND CallOption against the same collateral
  // rather than failing on an archived contract. The MM pays premium per visible
  // option, so the buyer would pay twice for one lot of collateral, and the surviving
  // option keeps the vault from ever reading as settled. A stable id makes the ledger
  // dedup the retry.
  test('is deterministic per epoch, so a replayed write dedups', async () => {
    const reads: TickReads = {
      ...baseReads,
      windowState: 'Locked',
      allocationPresent: true,
      allocationCid: '00alloc',
      allocationAmount: '3.0',
      latestPrice: '60000.0',
      workingEpoch: 7,
    }
    const first = recorder()
    await writeCall({ session: first.session, reads, cfg } as unknown as HandlerCtx)
    const second = recorder()
    await writeCall({ session: second.session, reads, cfg } as unknown as HandlerCtx)

    const idOf = (r: typeof first) => r.calls.find((c) => c.choice === 'WriteCall')?.commandId
    expect(idOf(first)).toBe('epoch-7-write')
    expect(idOf(first)).toBe(idOf(second))
  })
})
