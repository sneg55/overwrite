// Plan 008, second half: one depositor holding more than one position in the same
// epoch. A mid-window deposit produces exactly that (the rolled position plus the new
// one), and the fan-out used to treat "has this depositor been paid?" as a set
// membership test over receipt depositors. So the second position was filtered out and
// never paid, receipts stayed below the position count, and the scheduler re-dispatched
// DistributePremium every tick forever: the vault wedged one step later than the lock
// bug, with no error to show for it.
//
// Observed live before the fix: epoch 5 held 4 positions (alice twice) and only ever
// reached 3 receipts.

import { describe, expect, test } from 'bun:test'
import { distributePremium, type HandlerCtx } from './handlers'
import { baseReads, cfg, recorder } from './handlers-fixtures'
import type { TickReads } from './reads'

const position = (cid: string, depositor: string, principalCbtc: string) => ({
  cid,
  depositor,
  principalCbtc,
  epochNumber: 1,
  withdrawQueued: false,
})

// alice deposited again mid-window, so she holds both a rolled 1.0 and a fresh 0.5.
const twoPositionsForAlice: TickReads = {
  ...baseReads,
  windowState: 'Locked',
  allocationPresent: true,
  optionCid: '00o',
  optionState: 'Active',
  optionPremiumUsdc: '250.0',
  premiumHoldingCid: '00prem',
  premiumAmount: '250.0',
  positions: [
    position('pa1', 'alice', '1.0'),
    position('pb', 'bob', '1.0'),
    position('pa2', 'alice', '0.5'),
  ],
}

describe('premium fan-out with several positions per depositor', () => {
  test('pays every position, not one per depositor', async () => {
    const rec = recorder()
    await distributePremium({
      session: rec.session,
      reads: twoPositionsForAlice,
      cfg,
    } as unknown as HandlerCtx)

    const payouts = rec.calls.filter((c) => c.choice === 'PayoutPremium')
    expect(payouts.map((p) => p.contractId).sort()).toEqual(['pa1', 'pa2', 'pb'])
  })

  test('splits the premium by principal across positions, not across depositors', async () => {
    const rec = recorder()
    await distributePremium({
      session: rec.session,
      reads: twoPositionsForAlice,
      cfg,
    } as unknown as HandlerCtx)

    // 2.5 CBTC of principal against 250 premium: 100 per whole CBTC. Asserted to the
    // cent rather than exactly, because splitPremium reserves one unit per position
    // and lets the last one absorb the rounding, so the shares land a unit off nominal.
    const paid = new Map(
      rec.calls
        .filter((c) => c.choice === 'PayoutPremium')
        .map((c) => [c.contractId, Number(c.choiceArgument.premiumUsdc)]),
    )
    const of = (cid: string): number => paid.get(cid) ?? Number.NaN
    expect(of('pa1')).toBeCloseTo(100, 2)
    expect(of('pb')).toBeCloseTo(100, 2)
    expect(of('pa2')).toBeCloseTo(50, 2)
    // The invariant that actually matters: the fan-out pays out the premium exactly,
    // and alice's two positions together earn what her 1.5 CBTC is due.
    const total = [...paid.values()].reduce((a, b) => a + b, 0)
    expect(total).toBeCloseTo(250, 9)
    expect(of('pa1') + of('pa2')).toBeCloseTo(150, 2)
  })

  test('gives every payout its own transfer reference', async () => {
    const rec = recorder()
    await distributePremium({
      session: rec.session,
      reads: twoPositionsForAlice,
      cfg,
    } as unknown as HandlerCtx)

    // The reference is what a depositor's two receipts are told apart by. Keyed on the
    // depositor alone, alice's two payouts recorded the identical ref.
    const refs = rec.calls
      .filter((c) => c.choice === 'PayoutPremium')
      .map((c) => c.choiceArgument.transferRef)
    expect(new Set(refs).size).toBe(refs.length)
  })

  test('gives every payout its own command id, so one does not dedup the other', async () => {
    const rec = recorder()
    await distributePremium({
      session: rec.session,
      reads: twoPositionsForAlice,
      cfg,
    } as unknown as HandlerCtx)

    // Two commands submitted under one id are deduplicated by the ledger, so alice's
    // second payout would be silently dropped even once it was no longer filtered out.
    const ids = rec.calls.filter((c) => c.choice === 'PayoutPremium').map((c) => c.commandId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('resumes a partly-paid fan-out without paying the same position twice', async () => {
    const rec = recorder()
    // One of alice's two positions is already paid, so she has one receipt and one
    // position still owed. Receipts carry a depositor, not a position, so the count is
    // the only thing that can say how many of her positions are still outstanding.
    await distributePremium({
      session: rec.session,
      reads: { ...twoPositionsForAlice, receiptDepositors: ['alice', 'bob'] },
      cfg,
    } as unknown as HandlerCtx)

    const payouts = rec.calls.filter((c) => c.choice === 'PayoutPremium')
    expect(payouts.map((p) => p.contractId)).toEqual(['pa2'])
  })

  test('pays nothing more once every position has a receipt', async () => {
    const rec = recorder()
    await distributePremium({
      session: rec.session,
      reads: { ...twoPositionsForAlice, receiptDepositors: ['alice', 'alice', 'bob'] },
      cfg,
    } as unknown as HandlerCtx)

    expect(rec.calls.filter((c) => c.choice === 'PayoutPremium')).toHaveLength(0)
  })
})
