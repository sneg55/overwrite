import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { distributePremium, type HandlerCtx, writeCall } from './handlers'
import { baseReads, cfg, recorder } from './handlers-fixtures'
import type { TickReads } from './reads'

// The fan-out's command ids and transfer refs are keyed on the position contract id.
const positionHash = (positionCid: string): string =>
  createHash('sha256').update(positionCid).digest('hex').slice(0, 16)

describe('writeCall', () => {
  test('derives premium (notional*spot*bps) and passes the allocation and notional', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      windowState: 'Locked',
      allocationPresent: true,
      allocationCid: '00alloc',
      allocationAmount: '3.0',
      latestPrice: '60000.0',
    }
    await writeCall({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const call = rec.calls.find((c) => c.choice === 'WriteCall')
    expect(call?.choiceArgument.notionalCbtc).toBe('3.0')
    expect(call?.choiceArgument.collateralAllocationCid).toBe('00alloc')
    // 3.0 * 60000 * (100/10000) = 1800
    expect(call?.choiceArgument.premiumUsdc).toBe('1800.0')
    expect(typeof call?.choiceArgument.expiry).toBe('string')
    // WriteCall is now controller operator, mmBuyer (the CallOption it creates is
    // signatory operator, mmBuyer), so the command must carry both authorities.
    expect(call?.actAs).toEqual(['operator', 'mm'])
  })
})

describe('distributePremium', () => {
  test('splits the received premium and pays one PayoutPremium per unpaid position', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      windowState: 'Locked',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionPremiumUsdc: '300.0',
      premiumHoldingCid: '00prem',
      premiumAmount: '300.0',
      positions: [
        {
          cid: 'pa',
          depositor: 'alice',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pb',
          depositor: 'bob',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pc',
          depositor: 'carol',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
      ],
    }
    await distributePremium({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const payouts = rec.calls.filter((c) => c.choice === 'PayoutPremium')
    expect(payouts).toHaveLength(3)
    expect(payouts.map((p) => p.choiceArgument.premiumUsdc)).toEqual(['100.0', '100.0', '100.0'])
    // two splits for three positions (the last is paid from the remainder directly)
    expect(rec.calls.filter((c) => c.choice === 'Split')).toHaveLength(2)
  })

  test('resumes premium distribution without paying a depositor twice', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      windowState: 'Locked',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionPremiumUsdc: '300.0',
      premiumHoldingCid: '00prem',
      premiumAmount: '200.0',
      receiptDepositors: ['alice'],
      receiptTotalUsdc: 100,
      positions: [
        {
          cid: 'pa',
          depositor: 'alice',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pb',
          depositor: 'bob',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pc',
          depositor: 'carol',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
      ],
    }
    await distributePremium({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const payouts = rec.calls.filter((c) => c.choice === 'PayoutPremium')
    // The reference carries a position discriminator as well as the depositor: a
    // depositor can hold two positions in one epoch, and a depositor-only ref put the
    // same string on both receipts.
    expect(payouts.map((p) => p.contractId)).toEqual(['pb', 'pc'])
    expect(payouts.map((p) => p.choiceArgument.transferRef)).toEqual([
      `epoch-1-bob-${positionHash('pb')}`,
      `epoch-1-carol-${positionHash('pc')}`,
    ])
    expect(payouts.map((p) => p.choiceArgument.premiumUsdc)).toEqual(['100.0', '100.0'])
    const paidTotal = payouts.reduce(
      (total, payout) => total + Number(payout.choiceArgument.premiumUsdc),
      reads.receiptTotalUsdc,
    )
    expect(paidTotal).toBe(Number(reads.optionPremiumUsdc))
  })

  test('replays the same logical operations with the same command ids', async () => {
    const rec = recorder()
    const reads: TickReads = {
      ...baseReads,
      windowState: 'Locked',
      allocationPresent: true,
      optionCid: '00o',
      optionState: 'Active',
      optionPremiumUsdc: '300.0',
      premiumHoldingCid: '00prem',
      premiumAmount: '300.0',
      positions: [
        {
          cid: 'pa',
          depositor: 'alice',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pb',
          depositor: 'bob',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
        {
          cid: 'pc',
          depositor: 'carol',
          principalCbtc: '1.0',
          epochNumber: 1,
          withdrawQueued: false,
        },
      ],
    }

    await distributePremium({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const firstRun = [...rec.calls]
    await distributePremium({ session: rec.session, reads, cfg } as unknown as HandlerCtx)
    const secondRun = rec.calls.slice(firstRun.length)

    expect(secondRun.map((call) => call.commandId)).toEqual(firstRun.map((call) => call.commandId))
    // Keyed on the position, not the depositor. A depositor holding two positions in
    // one epoch would otherwise submit both payouts under one command id and have the
    // ledger dedup the second away.
    expect(firstRun.map((call) => call.commandId)).toEqual([
      `epoch-1-split-${positionHash('pa')}`,
      `epoch-1-payout-${positionHash('pa')}`,
      `epoch-1-split-${positionHash('pb')}`,
      `epoch-1-payout-${positionHash('pb')}`,
      `epoch-1-payout-${positionHash('pc')}`,
    ])
    for (const run of [firstRun, secondRun]) {
      const payoutRefs = run
        .filter((call) => call.choice === 'PayoutPremium')
        .map((call) => call.choiceArgument.transferRef)
      expect(new Set(payoutRefs).size).toBe(payoutRefs.length)
    }
  })
})
