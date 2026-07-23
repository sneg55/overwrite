import { expect, test } from 'bun:test'
import { BuyerPosition } from '@/components/buyer-position'
import type { VaultView } from '@/lib/types'
import { renderMarkup } from '@/test/render'

const ACTIVE: VaultView = {
  notionalCbtc: 3,
  epochNumber: 4,
  strikeUsdPerCbtc: 110_000,
  premiumUsdc: 900,
  optionState: 'Active',
  expiryIso: '2026-07-27T10:00:00.000Z',
}

test('premium is written as money this party paid, not money collected', () => {
  const html = renderMarkup(<BuyerPosition option={ACTIVE} />)
  expect(html).toContain('Premium you paid')
  // The vault's own sign. Showing it here would tell the buyer its outflow was income.
  expect(html).not.toContain('Premium collected')
  expect(html).not.toContain('Premium this epoch')
})

test('an unpaid premium is an obligation, not a payment', () => {
  const html = renderMarkup(<BuyerPosition option={{ ...ACTIVE, optionState: 'Written' }} />)
  expect(html).toContain('Premium you owe')
  expect(html).not.toContain('Premium you paid')
})

test('the strike cash the buyer must allocate is stated, not left to be worked out', () => {
  const html = renderMarkup(<BuyerPosition option={ACTIVE} />)
  expect(html).toContain('Cash to allocate if exercised')
  // 3 CBTC at a 110,000 strike. Arithmetic on two fields of the contract, no model.
  expect(html).toContain('330,000')
})

test('the simulation and demo-parameter labels survive', () => {
  const html = renderMarkup(<BuyerPosition option={ACTIVE} />)
  expect(html).toContain('MM simulated')
  expect(html).toContain('demo parameter')
})

test('no yield or return claim is made anywhere on the card', () => {
  const html = renderMarkup(<BuyerPosition option={ACTIVE} />)
  for (const banned of ['APY', 'APR', 'yield', 'annualized', 'return on']) {
    expect(html).not.toContain(banned)
  }
})
