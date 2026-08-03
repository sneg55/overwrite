import { expect, test } from 'bun:test'
import { PremiumHistory } from '@/components/premium-history'
import type { EpochReportView } from '@/lib/types'
import { renderMarkup } from '@/test/render'

const reports: EpochReportView[] = [
  { epochNumber: 4, settlementPath: 'OTM', totalPremiumUsdc: 800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: true },
  { epochNumber: 5, settlementPath: 'ITM', totalPremiumUsdc: 900, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
]

test('premium history lists each epoch and tags each figure a demo parameter', () => {
  const html = renderMarkup(<PremiumHistory reports={reports} />)
  expect(html).toContain('#4')
  expect(html).toContain('#5')
  expect(html).toContain('demo parameter')
  expect(html).not.toMatch(/apy/i)
})

test('premium history totals the premium column', () => {
  const html = renderMarkup(<PremiumHistory reports={reports} />)
  expect(html).toContain('$1,700')
})

// The ledger issues one EpochReport per depositor, all carrying the same aggregate, and
// the operator observes every copy. Summing the raw list multiplied the headline premium
// by the depositor count: three depositors turned three settled epochs at $1,915 into a
// reported $17,234 on the live demo. Inflating the one number this project refuses to
// overstate is worse than the duplicate rows that made it visible.
test('premium history collapses per-depositor copies and totals each epoch once', () => {
  const perDepositor: EpochReportView[] = [
    { epochNumber: 4, settlementPath: 'OTM', totalPremiumUsdc: 800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: true },
    { epochNumber: 4, settlementPath: 'OTM', totalPremiumUsdc: 800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: true },
    { epochNumber: 4, settlementPath: 'OTM', totalPremiumUsdc: 800, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: true },
    { epochNumber: 5, settlementPath: 'ITM', totalPremiumUsdc: 900, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
    { epochNumber: 5, settlementPath: 'ITM', totalPremiumUsdc: 900, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
    { epochNumber: 5, settlementPath: 'ITM', totalPremiumUsdc: 900, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false },
  ]
  const html = renderMarkup(<PremiumHistory reports={perDepositor} />)
  expect(html).toContain('$1,700')
  expect(html).not.toContain('$5,100')
  // One row per epoch, not one per report copy.
  expect(html.split('>#4<').length - 1).toBe(1)
  expect(html.split('>#5<').length - 1).toBe(1)
})

test('premium history shows Not recorded for an unknown settlement path', () => {
  const unknown: EpochReportView[] = [{ epochNumber: 6, settlementPath: 'unknown', totalPremiumUsdc: 0, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false }]
  const html = renderMarkup(<PremiumHistory reports={unknown} />)
  expect(html).toContain('Not recorded')
})
