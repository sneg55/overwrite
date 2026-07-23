import { expect, test } from 'bun:test'
import { dedupeReportsByEpoch, groupByDepositor, joinReceiptsToReports, needsDepositorColumn } from '@/lib/join'
import type { EpochReportView, PositionView, ReceiptView } from '@/lib/types'

const reports: EpochReportView[] = [
  { epochNumber: 4, settlementPath: 'OTM', totalPremiumUsdc: 800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: true },
  { epochNumber: 5, settlementPath: 'ITM', totalPremiumUsdc: 900, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
]

test('attaches the viewer own receipt to the matching epoch', () => {
  const receipts: ReceiptView[] = [{ depositor: 'alice', epochNumber: 5, premiumPaidUsdc: 300 }]
  const rows = joinReceiptsToReports(reports, receipts, 'alice')
  expect(rows.find((r) => r.epochNumber === 5)?.ownReceiptUsdc).toBe(300)
})

test('null when the viewer holds no receipt for an epoch', () => {
  const rows = joinReceiptsToReports(reports, [], 'alice')
  expect(rows.every((r) => r.ownReceiptUsdc === null)).toBe(true)
})

test('only the acting party own receipt counts, never another depositor', () => {
  // The operator observes every depositor's receipt, but none of them are its own.
  const receipts: ReceiptView[] = [
    { depositor: 'alice', epochNumber: 5, premiumPaidUsdc: 300 },
    { depositor: 'bob', epochNumber: 5, premiumPaidUsdc: 600 },
  ]
  const asOperator = joinReceiptsToReports(reports, receipts, 'operator')
  expect(asOperator.find((r) => r.epochNumber === 5)?.ownReceiptUsdc).toBe(null)

  const asBob = joinReceiptsToReports(reports, receipts, 'bob')
  expect(asBob.find((r) => r.epochNumber === 5)?.ownReceiptUsdc).toBe(600)
})

test('collapses the per-depositor report copies to one row per epoch', () => {
  // The ledger issues one EpochReport per depositor; the operator observes all copies.
  const perDepositor: EpochReportView[] = [
    { epochNumber: 1, settlementPath: 'ITM', totalPremiumUsdc: 1800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
    { epochNumber: 1, settlementPath: 'ITM', totalPremiumUsdc: 1800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
    { epochNumber: 1, settlementPath: 'ITM', totalPremiumUsdc: 1800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
  ]
  expect(dedupeReportsByEpoch(perDepositor).length).toBe(1)

  const rows = joinReceiptsToReports(perDepositor, [], 'operator')
  expect(rows.length).toBe(1)
  expect(rows[0]?.epochNumber).toBe(1)
  expect(rows[0]?.ownReceiptUsdc).toBe(null)
})

test('drops the depositor column only when every row belongs to the viewer', () => {
  const mine = [{ depositor: 'alice' }, { depositor: 'alice' }]
  expect(needsDepositorColumn(mine, 'alice')).toBe(false)

  // The operator's book spans depositors, so the column has work to do.
  const book = [{ depositor: 'alice' }, { depositor: 'bob' }, { depositor: 'carol' }]
  expect(needsDepositorColumn(book, 'operator')).toBe(true)
})

test('a single foreign row brings the depositor column back', () => {
  // The privacy invariant: the column is what tells a reader whose row is whose, so it
  // may never be dropped while a row belongs to someone other than the viewer. If ledger
  // scoping ever widened, the table must not silently render an unattributed row.
  const leaked = [{ depositor: 'alice' }, { depositor: 'alice' }, { depositor: 'bob' }]
  expect(needsDepositorColumn(leaked, 'alice')).toBe(true)
})

test('an empty table needs no depositor column', () => {
  expect(needsDepositorColumn([], 'alice')).toBe(false)
})

// ── groupByDepositor ─────────────────────────────────────────────────────────

const pos = (depositor: string, principalCbtc: number, contractId: string): PositionView => ({
  contractId,
  depositor,
  principalCbtc,
  epochNumber: 3,
  withdrawQueued: false,
})

test('groupByDepositor sums a depositor split across several contracts', () => {
  // Each deposit is its own contract, so the operator's book fragments. What any one
  // depositor holds is the figure the rows never state.
  const groups = groupByDepositor([
    pos('alice', 1, 'c1'),
    pos('bob', 2, 'c2'),
    pos('alice', 0.5, 'c3'),
  ])
  expect(groups.map((g) => g.depositor)).toEqual(['alice', 'bob'])
  expect(groups[0]?.totalCbtc).toBe(1.5)
  expect(groups[0]?.rows.length).toBe(2)
  expect(groups[1]?.totalCbtc).toBe(2)
})

test('groupByDepositor keeps first-seen order so the table does not reshuffle', () => {
  const groups = groupByDepositor([pos('carol', 1, 'c1'), pos('alice', 1, 'c2')])
  expect(groups.map((g) => g.depositor)).toEqual(['carol', 'alice'])
})

test('groupByDepositor on an empty book yields no groups', () => {
  expect(groupByDepositor([])).toEqual([])
})
