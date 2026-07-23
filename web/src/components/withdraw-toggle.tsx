'use client'

// The withdraw-queue control. Once queued (the ledger says so), it is a non-interactive
// status pill: withdrawal is never un-queued from here (principal returns at the
// boundary). Before that it is a two-step confirm (Queue withdrawal, then Confirm or
// Cancel) with a pending state and an aria-live result line. After a successful submit
// the parent route revalidates and re-renders this with queued=true.
//
// `owned` gates the action: QueueWithdraw is `controller depositor`, so only the
// position's own depositor can queue it. When a non-owner views the row (the operator
// reading the whole book), we show read-only status, never a button they cannot honor.

import { useActionState, useState } from 'react'
import { type ActionState, queueWithdrawAction } from '@/lib/withdraw-actions'

const INITIAL: ActionState = { status: 'idle', message: '' }

export function WithdrawToggle({
  positionCid,
  queued,
  owned = true,
}: {
  positionCid: string
  queued: boolean
  owned?: boolean
}) {
  const [state, action, pending] = useActionState(queueWithdrawAction, INITIAL)
  const [confirming, setConfirming] = useState(false)

  if (queued) {
    return <span className="pill pill-queued">Queued for next epoch</span>
  }

  if (!owned) {
    // "Rolling" was undefined anywhere in the UI. Say what it means.
    return <span className="pill">Rolls to next epoch</span>
  }

  return (
    <form action={action} className="action-row">
      <input type="hidden" name="positionCid" value={positionCid} />
      {confirming ? (
        <>
          {/* Queuing is never un-queued from here, so it gets a deliberate second step.
              Before this it committed on one click while the reversible deposit had a
              full review dialog: the irreversible action had the lighter touch. */}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            {pending ? 'Queuing...' : 'Confirm'}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => setConfirming(true)}
          disabled={state.status === 'ok'}
        >
          Queue withdrawal
        </button>
      )}
      <span className="field-hint">
        Your principal returns at the end of the current epoch. This cannot be undone here.
      </span>
      <span className="action-status" data-status={state.status} role="status" aria-live="polite">
        {state.status === 'idle' ? '' : state.message}
      </span>
    </form>
  )
}
