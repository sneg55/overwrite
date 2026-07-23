import type { Metadata } from 'next'
import { preload } from 'react-dom'
import { MarketingFooter, MarketingLimits } from '@/components/marketing/closing'
import { MarketingExplainer } from '@/components/marketing/explainer'
import { MarketingHeader, MarketingHero } from '@/components/marketing/hero'

// The marketing display face (Archivo) is self-hosted via @font-face in marketing.css and
// scoped to `.mkt`, so it never leaves the origin (on brand for a privacy product) and the
// data app keeps its system stack. Archivo is a grotesque with a real width axis, which lets
// the headings read as engineered and institutional (font-stretch) without the
// editorial-serif or geometric-sans reflex.

export const metadata: Metadata = {
  title: { absolute: 'Overwrite · CBTC covered-call vault on Canton' },
  description:
    'Deposit CBTC and collect option premium on-chain. Overwrite writes weekly physically-settled covered calls as Daml contracts on Canton, with a per-depositor book nobody else can see.',
}

// The public marketing page at `/`. Static server component: no ledger reads, no party
// session. The working app lives at /app; every CTA points there. The honesty rails
// (simulated MM and oracle, premium as a demo parameter, no APY, no CBTC mint/burn) are
// stated in the copy, not buried, because they are part of the pitch. The banner (header)
// and contentinfo (footer) sit outside <main> so the landmark structure is complete.
export default function LandingPage() {
  // Preload the display face on this route only (not /app), so it lands before first paint
  // and the metric-matched fallback swap is imperceptible. crossOrigin matches the CORS mode
  // the browser uses to fetch @font-face, so the preload is reused rather than double-fetched.
  preload('/fonts/archivo-latin-var.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  })

  return (
    <div className="mkt">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <MarketingHeader />
      <main id="main">
        <MarketingHero />
        <MarketingExplainer />
        <MarketingLimits />
      </main>
      <MarketingFooter />
    </div>
  )
}
