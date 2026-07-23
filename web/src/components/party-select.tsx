'use client'

// Progressive enhancement over the plain <select> inside the switcher form.
// With JS: changing the selection submits the form immediately, and the control is
// disabled while the server re-renders. Without JS: it is an ordinary <select>, and
// the <noscript> submit button in party-switcher.tsx posts the form.

import { useState } from 'react'
import { createPortal, useFormStatus } from 'react-dom'
import { PARTIES, PARTY_ROLE, type Party } from '@/lib/parties'

export function PartySelect({ current }: { current: Party }) {
  const { pending } = useFormStatus()
  // The party being switched to, captured on change so the veil can name it. Null until a
  // switch is in flight; the component remounts (the select is keyed on `current`) once the
  // new party renders, so this resets on its own.
  const [target, setTarget] = useState<string | null>(null)

  return (
    <>
      <select
        // `defaultValue` is only read on mount, so after the server action re-renders
        // this select it would keep showing the party you switched away from. Keying on
        // `current` remounts it, so the label can never contradict the rendered party.
        key={current}
        id="party"
        name="party"
        className="switcher-select"
        defaultValue={current}
        disabled={pending}
        aria-label="View the ledger as a different party"
        onChange={(e) => {
          setTarget(e.currentTarget.value)
          e.currentTarget.form?.requestSubmit()
        }}
      >
        {PARTIES.map((p) => (
          <option key={p} value={p}>
            {p} ({PARTY_ROLE[p]})
          </option>
        ))}
      </select>

      {/* A switch is a soft server-action transition, so React holds the OLD page visible
          until the new party's server render commits. On the operator's book that means
          another depositor's rows stay on screen for the second or two the re-read takes,
          which reads as a privacy leak even though the ledger never sent the new party that
          data. The veil covers the stale page for exactly that window and reinforces what is
          actually happening: the ledger is being re-read as the chosen party. */}
      {/* Portalled to <body>: the veil is position: fixed, but the sticky header above it
          has a backdrop-filter, which makes the header a containing block for fixed
          descendants and would trap the veil in the header band. Rendering it at the body
          escapes that so inset: 0 is the viewport. */}
      {pending &&
        typeof document !== 'undefined' &&
        createPortal(
          <div className="switch-veil" role="status" aria-live="polite">
            <span className="brand-mark" aria-hidden="true" />
            <span className="switch-veil-text">
              Reading the ledger as{' '}
              <strong>{target !== null && isParty(target) ? target : 'the selected party'}</strong>
              &hellip;
            </span>
          </div>,
          document.body,
        )}
    </>
  )
}

function isParty(value: string): value is Party {
  return (PARTIES as readonly string[]).includes(value)
}
