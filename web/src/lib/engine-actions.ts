'use server'

// Operator control over the scheduler. The acting party is read server-side from the
// session and never from the form, exactly like the deposit and withdraw actions, so a
// depositor cannot pause the vault engine by posting to this route. The backend enforces
// the same rule independently: /engine is operator-only there too, and this check is the
// UI's own, not a substitute for it.
//
// These are plain form actions rather than useActionState reducers, because the panel
// they sit in is a server component that re-reads the engine's status on every render.
// The status IS the result of a successful click, so there is nothing for a reducer to
// hold. A failure has nowhere to land in that shape, so it is carried back on the query
// string and rendered by the panel; swallowing it would leave the operator looking at a
// button that silently does nothing.

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { ENGINE_ERROR_PARAM, writeAs } from './ledger-api'
import { getActingParty } from './party-session'

// writeAs prefers the backend's `detail` field, which for the engine routes is the error
// registry id rather than prose. An operator should not be shown E_SCHED_005 and left to
// look it up, so the ids this surface can actually produce are given their sentence here.
// Anything unmapped falls through unchanged, which is still better than hiding it.
const READABLE: Record<string, string> = {
  E_SCHED_005: 'the engine is running again, so there was nothing to step. Pause it first.',
  E_SCHED_006: 'no engine control channel is configured on the backend.',
  E_SCHED_007: 'the engine control file could not be read.',
}

async function control(route: string): Promise<never> {
  const party = await getActingParty()
  const result = await writeAs(party, route, {})
  revalidatePath('/app')
  // Redirect either way: on success it clears a stale error off the query string, and on
  // failure it puts the reason where the panel can render it beside the buttons.
  if (!result.ok) {
    const message = READABLE[result.error] ?? result.error
    redirect(`/app?${ENGINE_ERROR_PARAM}=${encodeURIComponent(message)}`)
  }
  redirect('/app')
}

export async function pauseEngine(): Promise<void> {
  await control('engine/pause')
}

export async function resumeEngine(): Promise<void> {
  await control('engine/resume')
}

export async function stepEngine(): Promise<void> {
  await control('engine/step')
}
