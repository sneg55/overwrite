import type { ReactNode } from 'react'
import { NavLink } from '@/components/nav-link'
import { PartySwitcher } from '@/components/party-switcher'
import { PARTY_LANDING, PARTY_ROLE, positionLabel } from '@/lib/parties'
import { getActingParty } from '@/lib/party-session'

// The app chrome (header, party switcher, primary nav) wraps only the product routes
// under /app. The marketing landing at `/` renders its own header from the root layout,
// so a first-time visitor never sees the operator nav or the party switcher.
export default async function AppLayout({ children }: { children: ReactNode }) {
  const party = await getActingParty()
  // The /app overview redirects any party whose data lives elsewhere (depositors land on
  // /app/position). Gate the tab on that same rule so the nav never offers a link that
  // just bounces the reader back to where they started.
  const canSeeVault = PARTY_LANDING[party] === '/app'
  // Only a depositor and the operator are ever stakeholders of a VaultPosition. For the
  // market maker and the observer the tab was a permanent dead end, and an empty page
  // reached through a link the product offered reads as something broken rather than as
  // a role that holds none. Derived from the role, not from a ledger read, so the nav
  // never depends on a fetch that could fail and silently drop a tab a party does hold.
  const role = PARTY_ROLE[party]
  const holdsPositions = role === 'Depositor' || role === 'Vault operator'
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a className="brand" href="/">
          <span className="brand-mark" aria-hidden="true" />
          Overwrite
        </a>
        <nav className="nav" aria-label="Primary">
          {canSeeVault && <NavLink href="/app">Vault</NavLink>}
          {holdsPositions && <NavLink href="/app/position">{positionLabel(party)}</NavLink>}
          <NavLink href="/app/reports">Settlement history</NavLink>
        </nav>
        <PartySwitcher current={party} />
      </header>
      <main className="main" id="main">
        {children}
      </main>
    </>
  )
}
