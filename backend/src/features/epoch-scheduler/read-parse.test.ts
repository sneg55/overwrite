import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import {
  parseOptions,
  parsePositions,
  parseReceipts,
  parseReports,
  parseSettlements,
  parseVault,
} from './read-parse'

const ac = (contractId: string, payload: Record<string, unknown>): ActiveContract => ({
  contractId,
  payload,
})

describe('read-parse', () => {
  test('parseVault coerces the Int epoch string', () => {
    const v = parseVault(ac('00v', { epochNumber: '2', windowState: 'Locked' }))
    expect(v).toEqual({ cid: '00v', epochNumber: 2, windowState: 'Locked' })
  })

  test('parsePositions maps fields and the withdraw flag', () => {
    const p = parsePositions([
      ac('00p', {
        depositor: 'alice',
        principalCbtc: '1.0',
        epochNumber: '1',
        withdrawQueued: false,
      }),
    ])
    expect(p[0]).toEqual({
      cid: '00p',
      depositor: 'alice',
      principalCbtc: '1.0',
      epochNumber: 1,
      withdrawQueued: false,
    })
  })

  test('parseOptions parses the ISO expiry to ms', () => {
    const o = parseOptions([
      ac('00o', {
        state: 'Active',
        expiry: '2026-07-10T00:00:00Z',
        premiumUsdc: '300.0',
        notionalCbtc: '3.0',
        strikeUsdcPerCbtc: '66000.0',
        mmBuyer: 'mm',
        epochNumber: '1',
      }),
    ])
    expect(o[0]?.state).toBe('Active')
    expect(o[0]?.strike).toBe('66000.0')
    expect(o[0]?.expiryMs).toBe(Date.parse('2026-07-10T00:00:00Z'))
  })

  test('parseReceipts carries the contract id (RecordEpoch needs cids, not names)', () => {
    const r = parseReceipts([
      ac('00r', { depositor: 'alice', epochNumber: '1', premiumPaidUsdc: '30.0' }),
    ])
    expect(r[0]).toEqual({
      cid: '00r',
      depositor: 'alice',
      epochNumber: 1,
      premiumPaidUsdc: '30.0',
    })
  })

  test('parseReports parses the settlement path off an EpochReport payload', () => {
    const r = parseReports([
      ac('00rep', { epochNumber: '1', settlementPath: 'OTM', collateralReturned: true }),
    ])
    expect(r[0]).toEqual({
      epochNumber: 1,
      settlementPath: 'OTM',
      collateralReturned: true,
    })
  })

  test('parseSettlements carries the cid and ledger-derived settlement facts', () => {
    const r = parseSettlements([
      ac('00settlement', {
        epochNumber: '1',
        settlementPath: 'ITM',
        collateralReturned: false,
      }),
    ])
    expect(r[0]).toEqual({
      cid: '00settlement',
      epochNumber: 1,
      settlementPath: 'ITM',
      collateralReturned: false,
    })
  })
})
