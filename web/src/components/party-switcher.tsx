// The privacy-reveal control, as a server-action form. Selecting a party sets a
// cookie on the server, re-renders every screen scoped to that party, and lands on
// that party's own page (a depositor on their position, everyone else on the vault).
// Switch to `observer` and the server produces empty views: the browser never receives
// data that party cannot see. This is not a client-side filter.
//
// It is a real <form>, so it works with JavaScript disabled. PartySelect adds the
// submit-on-change convenience when JS is available.

import { PartySelect } from '@/components/party-select'
import { PARTY_ROLE, type Party } from '@/lib/parties'
import { setParty } from '@/lib/party-actions'

export function PartySwitcher({ current }: { current: Party }) {
  return (
    <form action={setParty} className="switcher">
      <label className="switcher-label" htmlFor="party">
        Viewing as
      </label>
      <PartySelect current={current} />
      {/* Without JS there is no change handler, so the form needs a way to post. */}
      <noscript>
        <button className="switcher-submit" type="submit">
          Switch
        </button>
      </noscript>
      {/* Announced to screen readers after the server re-renders. */}
      <span className="sr-only" role="status">
        Viewing the ledger as {current}, {PARTY_ROLE[current]}
      </span>
    </form>
  )
}
