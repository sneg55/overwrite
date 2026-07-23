'use server'

// Queue a withdrawal on the acting party's OWN VaultPosition. The position cid comes
// from the party's own ACS (a depositor observes their own position), and the acting
// party is read server-side from the session, never from the form: nobody queues a
// withdrawal on another depositor's position.

import { revalidatePath } from 'next/cache'
import { writeAs } from './ledger-api'
import { getActingParty } from './party-session'

export interface ActionState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export async function queueWithdrawAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const positionCid = formData.get('positionCid')
  if (typeof positionCid !== 'string' || positionCid === '') {
    return { status: 'error', message: 'Missing position reference; reload and try again.' }
  }
  const party = await getActingParty()
  const result = await writeAs(party, 'queue-withdraw', { positionCid })
  if (!result.ok) return { status: 'error', message: result.error }
  revalidatePath('/app/position')
  revalidatePath('/app')
  return { status: 'ok', message: 'Withdrawal queued. Principal returns at the next epoch boundary.' }
}
