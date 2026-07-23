import Link from 'next/link'

const LIMITS = [
  {
    title: 'No unsecured counterparty exposure',
    body: 'Collateral is locked on-chain for the life of the option, so the buyer carries no unsecured exposure to the vault. That is a narrower claim than counterparty-risk-free, which we do not make.',
  },
  {
    title: 'The market maker and the price feed are simulated',
    body: 'This is a hackathon build. The market maker that pays the premium and the price feed that settles the option are both simulated, and labeled that way everywhere they appear.',
  },
  {
    title: 'Premium figures are demo parameters',
    body: 'Every premium number in the app is a demo parameter, not a quote and not market pricing. Overwrite publishes no yield and no APY.',
  },
  {
    title: 'Overwrite never mints or burns CBTC',
    body: 'The vault only transfers and allocates CBTC. Mint and burn are institution-gated, and this app never calls them.',
  },
]

// The honest-limits grid and the closing call to action. The honesty rails are stated
// plainly here because they are part of the pitch, not a disclaimer to bury.
export function MarketingLimits() {
  return (
    <>
      <section className="mkt-section" id="limits">
        <div className="mkt-shell">
          <p className="mkt-eyebrow">Limits</p>
          <h2 className="mkt-section-title">The limits of this build</h2>
          <div className="mkt-limits">
            {LIMITS.map((l) => (
              <article className="mkt-card" key={l.title}>
                <h3 className="mkt-card-title">{l.title}</h3>
                <p className="mkt-card-body">{l.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-shell">
        <div className="mkt-band">
          <h2 className="mkt-band-title">Watch the vault write a call.</h2>
          <p className="mkt-section-lead">
            Switch between two depositors and watch one ledger show each of them only their own
            book. Then try the observer, who is a stakeholder of nothing and sees exactly that.
          </p>
          <Link className="btn btn-primary" href="/app">
            Open the app
          </Link>
        </div>
      </section>
    </>
  )
}

// The page footer (contentinfo), rendered outside <main>.
export function MarketingFooter() {
  return (
    <footer className="mkt-footer">
      <div className="mkt-shell">
        <div className="mkt-footer-top">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true" />
            Overwrite
          </Link>
          <nav className="mkt-footer-nav" aria-label="Footer">
            <Link className="mkt-nav-link" href="/app">
              Open the app
            </Link>
            <a className="mkt-nav-link" href="#how">
              How it works
            </a>
            <a className="mkt-nav-link" href="#privacy">
              Privacy
            </a>
          </nav>
        </div>
        <p className="mkt-fineprint">
          Built for HackCanton S2 (BitSafe CBTC Bounty and Track 2, Financial Applications). A solo,
          AI-driven build running on the hackathon devnet. The market maker and the price feed are
          simulated. Premium figures are demo parameters, not market pricing, and no yield or APY is
          implied.
        </p>
      </div>
    </footer>
  )
}
