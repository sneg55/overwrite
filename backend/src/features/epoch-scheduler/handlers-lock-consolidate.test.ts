// Plan 008 regression: the operator's CBTC pool is consolidated into one holding
// before it is locked as collateral.
//
// Why this exists, and why it is not a hypothetical. A depositor who deposits while
// the window is open leaves the operator holding the previous pool AND the deposited
// amount as two separate contracts, while the vault's totalPooledCbtc counts both.
// The lock used to pick the single largest holding, which can then never satisfy
// Daml's amount check, so LockCollateral failed on every tick forever and the vault
// stopped rolling. Consolidating first is what the seeds already do when they build
// the pool, and what the 10-UTXO soft limit calls for regardless.
//
// Split from handlers-lock.test.ts under the file-size rule.

import { describe, expect, test } from 'bun:test'
import type { HandlerCtx } from './handlers'
import { baseReads, cfg, recorder } from './handlers-fixtures'
import { lockCollateral } from './handlers-lock'
import type { TickReads } from './reads'

describe('lockCollateral consolidates the pool', () => {
  test('merges fragmented operator CBTC holdings and locks the consolidated one', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00pool',
      poolAmount: '3.0',
      poolHoldingCids: ['00pool', '00deposited'],
      factoryCid: '00factory',
    }
    await lockCollateral({ session: rec.session, reads, cfg } as unknown as HandlerCtx)

    const merge = rec.calls.find((c) => c.choice === 'Merge')
    expect(merge?.contractId).toBe('00pool')
    expect(merge?.choiceArgument).toEqual({ otherCid: '00deposited' })
    expect(merge?.actAs).toEqual(['operator'])

    const lock = rec.calls.find((c) => c.choice === 'LockCollateral')
    expect(lock?.choiceArgument.cbtcPoolCid).toBe('merged1')
  })

  test('folds three holdings into one before locking', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00a',
      poolAmount: '3.0',
      poolHoldingCids: ['00a', '00b', '00c'],
      factoryCid: '00factory',
    }
    await lockCollateral({ session: rec.session, reads, cfg } as unknown as HandlerCtx)

    // Merge is pairwise, so N pieces take N-1 exercises, each folding the next piece
    // into the holding the previous merge produced.
    const merges = rec.calls.filter((c) => c.choice === 'Merge')
    expect(merges.map((m) => [m.contractId, m.choiceArgument.otherCid])).toEqual([
      ['00a', '00b'],
      ['merged1', '00c'],
    ])
    const lock = rec.calls.find((c) => c.choice === 'LockCollateral')
    expect(lock?.choiceArgument.cbtcPoolCid).toBe('merged2')
  })

  test('does not merge when the pool is already a single holding', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00pool',
      poolAmount: '3.0',
      poolHoldingCids: ['00pool'],
      factoryCid: '00factory',
    }
    await lockCollateral({ session: rec.session, reads, cfg } as unknown as HandlerCtx)

    expect(rec.calls.filter((c) => c.choice === 'Merge')).toHaveLength(0)
    const lock = rec.calls.find((c) => c.choice === 'LockCollateral')
    expect(lock?.choiceArgument.cbtcPoolCid).toBe('00pool')
  })

  test('merges under a deterministic command id, so a replayed tick dedups', async () => {
    // Merge is consuming, so a genuine replay fails on the archived contract rather
    // than double-merging. The stable id makes the ledger dedup the retry that
    // follows a lost response, which is the case a consuming choice cannot self-heal.
    const reads: TickReads = {
      ...baseReads,
      workingEpoch: 7,
      poolHoldingCid: '00pool',
      poolAmount: '3.0',
      poolHoldingCids: ['00pool', '00deposited'],
      factoryCid: '00factory',
    }
    const first = recorder()
    await lockCollateral({ session: first.session, reads, cfg } as unknown as HandlerCtx)
    const second = recorder()
    await lockCollateral({ session: second.session, reads, cfg } as unknown as HandlerCtx)

    const idOf = (r: typeof first) => r.calls.find((c) => c.choice === 'Merge')?.commandId
    expect(idOf(first)).toBe('epoch-7-pool-merge-1')
    expect(idOf(first)).toBe(idOf(second))
  })
})

describe('lockCollateral consolidation in registry mode', () => {
  // Real CBTC holdings are registry contracts, not the local Allocation:Holding
  // template, so the local Merge choice does not apply to them and the registry has
  // its own consolidation path. Real mode must therefore keep picking the largest
  // holding: that is exactly what the devnet deposit-and-lock proof did, where the
  // operator also held two unrelated dust holdings alongside the pool.
  test('never exercises the local Merge choice on registry holdings', async () => {
    const rec = recorder()
    const session = { ...rec.session, token: () => Promise.resolve('tok') }
    const registry = {
      factoryContext: () =>
        Promise.resolve({
          factoryId: '00realfactory',
          context: { contextValues: {}, disclosedContracts: [] },
          disclosed: [],
        }),
    }
    const reads: TickReads = {
      ...baseReads,
      poolHoldingCid: '00real',
      poolAmount: '0.99',
      poolHoldingCids: ['00real', '00dust'],
      factoryCid: '00factory',
    }
    await lockCollateral({
      session,
      reads,
      cfg: { ...cfg, useRealRegistry: true },
      registry,
    } as unknown as HandlerCtx)

    expect(rec.calls.filter((c) => c.choice === 'Merge')).toHaveLength(0)
    const lock = rec.calls.find((c) => c.choice === 'LockCollateralReal')
    expect(lock?.choiceArgument.cbtcPoolCid).toBe('00real')
  })
})
