import Link from 'next/link'
import { Badge } from '@/components/badge'

// The landing header: brand, anchor nav, and the primary CTA. Rendered outside <main>
// (it is the page banner), so it lives in its own component the page composes.
export function MarketingHeader() {
  return (
    <header className="mkt-header">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        Overwrite
      </Link>
      <nav className="mkt-nav" aria-label="Primary">
        <a className="mkt-nav-link" href="#pillars">
          Why Canton
        </a>
        <a className="mkt-nav-link" href="#how">
          How it works
        </a>
        <a className="mkt-nav-link" href="#privacy">
          Privacy
        </a>
        <a className="mkt-nav-link" href="#limits">
          Limits
        </a>
      </nav>
      <Link className="btn btn-primary mkt-header-cta" href="/app">
        Open the app
      </Link>
    </header>
  )
}

// The hero. The preview is a stylized copy of the real vault card, down to the honest
// badges; it is decorative, so it is hidden from assistive tech and the app itself carries
// the accessible, party-scoped version. On mobile it follows the headline (message first),
// not leads it: the card means nothing without the copy that frames it.
export function MarketingHero() {
  return (
    <section className="mkt-hero">
      <div className="mkt-shell mkt-hero-grid">
        <div>
          <p className="mkt-eyebrow">Privacy is the product</p>
          <h1 className="mkt-h1">Institutional BTC premium with a book nobody can see.</h1>
          <p className="mkt-lead">
            Deposit CBTC. Overwrite writes weekly physically-settled covered calls on Canton and
            pays the premium straight to holders on-chain. Your position is a contract between you
            and the vault, and the rest of the market cannot read it.
          </p>
          <div className="mkt-cta-row">
            <Link className="btn btn-primary" href="/app">
              Open the app
            </Link>
            <a className="btn btn-secondary" href="#how">
              How it works
            </a>
          </div>
          <p className="mkt-hero-note">
            A demo build on the Canton devnet. The market maker and the price feed are simulated,
            and every premium figure is a demo parameter. No wallet needed: the demo parties are
            pre-funded and backend-custodied.
          </p>
        </div>

        <div className="mkt-preview" aria-hidden="true">
          <div className="mkt-preview-head">
            <span className="mkt-preview-epoch">Epoch 3</span>
            <Badge tone="info">Collateral locked</Badge>
          </div>
          <div>
            <div className="mkt-preview-row">
              <span className="mkt-preview-label">Covered notional</span>
              <span className="mkt-preview-value">2.50 CBTC</span>
            </div>
            <div className="mkt-preview-row">
              <span className="mkt-preview-label">Strike</span>
              <span className="mkt-preview-value">$70,000 / CBTC</span>
            </div>
            <div className="mkt-preview-row">
              <span className="mkt-preview-label">Premium collected</span>
              <span className="mkt-preview-value">
                $1,240 <Badge tone="muted">demo parameter</Badge>
              </span>
            </div>
            <div className="mkt-preview-row">
              <span className="mkt-preview-label">Settlement</span>
              <span className="mkt-preview-value">
                Atomic DvP <Badge tone="warn">MM simulated</Badge>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
