// Three visually distinct ways a screen can show no data. Keeping them apart is a
// correctness concern, not a style one: this product's central claim is that an empty
// view is the ledger's own answer. If a backend outage rendered the same gray italic
// text as a privacy-scoped empty ACS, the UI would be asserting a fact it never
// observed. So an error looks like an error, loudly.

import type { ReactNode } from 'react'

/** The ledger answered, and the answer was nothing this party may see. */
export function EmptyState({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-title">{title}</span>
      <p className="empty-body">{children}</p>
    </div>
  )
}

/** We never got an answer. Says nothing about what the party can or cannot see. */
export function ErrorState({ detail }: { detail: string }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-title">Cannot reach the ledger</span>
      {/* Deliberately one short sentence: several of these can stack on one page, and the
          distinction it draws is the whole point of the component. */}
      <p className="error-body">
        The read failed, so this section is blank. That is not the ledger telling you this party
        sees nothing.
      </p>
      <span className="error-detail">{detail}</span>
    </div>
  )
}

/**
 * A field this party is not a stakeholder of. Distinct from EmptyState (the ledger
 * answered nothing) and ErrorState (we got no answer): this one says the row exists
 * and is not yours to read. Dropping such a row silently leaves the reader unable to
 * tell "no data" from "not mine", which is the same ambiguity ErrorState exists to
 * prevent, one level down.
 */
export function NotVisible() {
  return <span className="not-visible">Not visible to this party</span>
}

/** A standing disclaimer. Not a state. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="note note-inline">{children}</p>
}
