import { expect, test } from 'bun:test'
import LandingPage from '@/app/page'
import { MarketingExplainer } from '@/components/marketing/explainer'
import { MarketingHeader, MarketingHero } from '@/components/marketing/hero'
import { renderMarkup } from '@/test/render'

// The landing page is static marketing copy, so the tests guard the two things that
// actually matter: the CTAs point into the app, and the honesty rails are present and
// no APY/yield claim slipped in.

test('the primary CTA opens the app at /app', () => {
  const html = renderMarkup(<LandingPage />)
  expect(html).toContain('href="/app"')
  expect(html).toContain('Open the app')
})

test('the hero states the product without an APY or yield claim', () => {
  const html = renderMarkup(<LandingPage />)
  expect(html).toContain('Institutional BTC premium with a book nobody can see.')
  // "APY" appears only in the honest negation, never as a claimed rate. Guard against a
  // positive claim (a percentage APY, or an "APY of ...") rather than the bare word.
  expect(html).not.toMatch(/\d\s*%\s*apy/i)
  expect(html).not.toMatch(/apy of/i)
  expect(html).not.toMatch(/annual percentage/i)
  expect(html).toContain('no yield or APY is implied')
})

test('the honesty rails are stated on the page, not buried', () => {
  const html = renderMarkup(<LandingPage />)
  expect(html.toLowerCase()).toContain('simulated')
  expect(html).toContain('demo parameter')
  expect(html).toContain('no unsecured exposure')
})

test('the how-it-works section names the real settlement mechanism', () => {
  const html = renderMarkup(<LandingPage />)
  expect(html).toContain('CIP-56 allocation')
  expect(html).toContain('delivery-versus-payment')
})

test('the headline does not sell a yield the limits section disclaims', () => {
  const html = renderMarkup(<MarketingHero />)
  expect(html).not.toContain('yield')
  expect(html).toContain('premium')
})

test('every anchored section is reachable from the nav', () => {
  const nav = renderMarkup(<MarketingHeader />)
  for (const id of ['#pillars', '#how', '#privacy', '#limits']) {
    expect(nav).toContain(`href="${id}"`)
  }
})

test('the hero says what trying it requires', () => {
  const html = renderMarkup(<MarketingHero />)
  expect(html).toContain('No wallet needed')
})

test('the two expiry outcomes render as one forked step, not two sequential ones', () => {
  const html = renderMarkup(<MarketingExplainer />)
  // Five top-level steps, with the ITM/OTM pair nested inside the fourth.
  const topLevel = html.match(/class="mkt-flow-step"/g) ?? []
  expect(topLevel.length).toBe(5)
  expect(html).toContain('mkt-flow-branches')
})

test('the privacy pitch leads with the depositor pair, not the observer', () => {
  const html = renderMarkup(<MarketingExplainer />)
  const depositors = html.indexOf('two depositors')
  const observer = html.indexOf('observer')
  expect(depositors).toBeGreaterThan(-1)
  // The claim that carries weight comes first. A non-stakeholder seeing nothing is
  // close to tautological and proves far less.
  expect(observer === -1 || depositors < observer).toBe(true)
})
