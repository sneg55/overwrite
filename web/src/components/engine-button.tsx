'use client'

// The submit button inside each engine control form. A control is a server action that
// writes the control file and revalidates the page, so the click has real latency, and the
// engine only reflects a pause on its next tick. Without a pending state the button looked
// inert the moment after a click and invited a second one; this disables it and names what
// it is doing while the action is in flight, so the operator sees the click landed.

import { useFormStatus } from 'react-dom'

export function EngineButton({
  children,
  pendingLabel,
  variant,
}: {
  children: React.ReactNode
  pendingLabel: string
  variant: 'primary' | 'secondary'
}) {
  const { pending } = useFormStatus()
  return (
    <button className={`btn btn-${variant}`} type="submit" disabled={pending}>
      {pending ? pendingLabel : children}
    </button>
  )
}
