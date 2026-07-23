const PILLARS = [
  {
    title: 'The ledger enforces privacy',
    body: 'Switch between two depositors in the app and each sees only their own position, from the same vault in the same epoch. Only the operator and one depositor are parties to a position, so only they can read it. That is the Daml signatory and observer model doing the work, not a filter in the interface. The server renders what that party can read, and nothing else.',
  },
  {
    title: 'Settlement is atomic and physical',
    body: 'At expiry the locked CBTC and the strike cash move in one transaction, or neither moves. There is no escrow contract to trust and no public mempool to be front-run in.',
  },
  {
    title: 'Premium arrives as a transfer',
    body: 'Every epoch the vault transfers premium to each holder and writes each of them a receipt. Nothing sits in a claimable balance waiting to be harvested.',
  },
]

const FLOW = [
  {
    name: 'Deposits open',
    detail:
      'Holders deposit CBTC while the window is open. Each deposit becomes a VaultPosition signed by the operator and that one depositor, and by nobody else.',
  },
  {
    name: 'Collateral locks',
    detail:
      'The deposited CBTC moves into a CIP-56 allocation through the token registry and stays locked there for the life of the option.',
  },
  {
    name: 'The vault writes the call',
    detail:
      'The vault issues a CallOption and the market maker pays the premium. Each holder receives their own transfer and their own PremiumReceipt.',
  },
  {
    name: 'At expiry, one of two things happens',
    detail:
      'The settlement price decides which. Only one of these runs, and the ledger records which one it was.',
    branches: [
      {
        name: 'Out of the money',
        detail:
          'If the settlement price is at or below the strike, the collateral is released back to holders and they keep the premium.',
      },
      {
        name: 'In the money',
        detail:
          'If the settlement price is above the strike, the locked CBTC and the strike cash change hands in one atomic delivery-versus-payment transaction.',
      },
    ],
  },
  {
    name: 'Report, then roll',
    detail:
      'An EpochReport records the aggregate result and no per-holder payout list. Positions with no queued withdrawal roll into the next epoch.',
  },
]

// The value pillars, the epoch lifecycle, and the privacy contrast: the "what and why"
// body of the landing page, between the hero and the honest-limits close.
export function MarketingExplainer() {
  return (
    <>
      <section className="mkt-section" id="pillars">
        <div className="mkt-shell">
          <p className="mkt-eyebrow">Why Canton</p>
          <h2 className="mkt-section-title">What a public EVM vault cannot offer an institution</h2>
          <div className="mkt-pillars">
            {PILLARS.map((p) => (
              <article className="mkt-pillar" key={p.title}>
                <h3 className="mkt-pillar-title">{p.title}</h3>
                <p className="mkt-card-body">{p.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-section" id="how">
        <div className="mkt-shell">
          <p className="mkt-eyebrow">How it works</p>
          <h2 className="mkt-section-title">One epoch, one full option lifecycle</h2>
          <p className="mkt-section-lead">
            The vault runs in epochs. A production epoch is a week; this demo compresses it to
            minutes so you can watch a whole one. Every step below is a state change on the ledger.
          </p>
          <ol className="mkt-flow">
            {FLOW.map((step) => (
              <li className="mkt-flow-step" key={step.name}>
                <div>
                  <div className="mkt-flow-name">{step.name}</div>
                  <p className="mkt-flow-detail">{step.detail}</p>
                  {step.branches !== undefined && (
                    // A fork, not two more steps. Rendering these as siblings in the
                    // ordered list presented two mutually exclusive outcomes as things
                    // that both happen, in order.
                    <div className="mkt-flow-branches">
                      {step.branches.map((b) => (
                        <div className="mkt-flow-branch" key={b.name}>
                          <div className="mkt-flow-name">{b.name}</div>
                          <p className="mkt-flow-detail">{b.detail}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mkt-section" id="privacy">
        <div className="mkt-shell">
          <p className="mkt-eyebrow">Privacy</p>
          <h2 className="mkt-section-title">A public vault shows the market its whole book</h2>
          <p className="mkt-section-lead">
            On an EVM option vault, anyone can read the depositors, the vault size, the strikes, and
            the roll schedule, and market makers price against that flow. On Canton, a position is a
            contract between two parties and only those parties can see it.
          </p>
          <div className="mkt-compare">
            <div className="mkt-compare-col" data-kind="public">
              <p className="mkt-compare-kicker">EVM option vaults</p>
              <ul className="mkt-list">
                <li>Depositor addresses and position sizes are public.</li>
                <li>Strikes and roll timing are readable on-chain.</li>
                <li>Market makers can price against your flow before you trade it.</li>
                <li>Selling vol here means publishing your BTC book to do it.</li>
              </ul>
            </div>
            <div className="mkt-compare-col" data-kind="private">
              <p className="mkt-compare-kicker">Overwrite on Canton</p>
              <ul className="mkt-list">
                <li>A VaultPosition is signed by the operator and one depositor. Nobody else is a stakeholder.</li>
                <li>Premium and settlement receipts are per-depositor, so no holder learns of any other.</li>
                <li>The EpochReport carries aggregate totals and a depositor count. That is all.</li>
                <li>The observer party is a stakeholder of nothing, so its ledger view comes back empty.</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
