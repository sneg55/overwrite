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

test('premium history shows Not recorded for an unknown settlement path', () => {
  const unknown: EpochReportView[] = [{ epochNumber: 6, settlementPath: 'unknown', totalPremiumUsdc: 0, totalNotionalCbtc: 3, depositorCount: 3, collateralReturned: false }]
  const html = renderMarkup(<PremiumHistory reports={unknown} />)
  expect(html).toContain('Not recorded')
})
