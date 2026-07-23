'use server'

// Switching the acting party is a server action, not a client cookie write. That
// keeps the control working with JavaScript disabled and lets the browser announce
// the navigation.
//
// After setting the cookie it redirects to the party's own landing page (PARTY_LANDING):
// a depositor is not a stakeholder on the Vault contract, so leaving them on `/` would
// strand them on an empty page while their deposit and premium live on `/position`.
// The operator, market maker, and observer land on the vault overview.
//
// DEMO NOTE: this is still not an auth boundary. The party is chosen by whoever holds
// the browser, exactly as before. Production must bind the party to an authenticated
// server session. What changed is only how the choice is transported.

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { isParty, PARTY_COOKIE, PARTY_LANDING } from './parties'

export async function setParty(formData: FormData): Promise<void> {
  const requested = formData.get('party')
  const value = typeof requested === 'string' ? requested : undefined

  // An unknown party falls through to the cookie default (`observer`, sees nothing)
  // rather than being written. Never trust a form field to name a ledger party.
  if (!isParty(value)) return

  const store = await cookies()
  store.set(PARTY_COOKIE, value, {
    path: '/',
    maxAge: 86_400,
    sameSite: 'lax',
    httpOnly: false,
  })

  // Every app screen is party-scoped, so the whole /app tree is stale. The marketing
  // page at `/` is party-independent, so it does not need revalidating here.
  revalidatePath('/app', 'layout')

  // Land on the page this party can actually see. `redirect` throws NEXT_REDIRECT, so
  // it must run last and outside any try/catch.
  redirect(PARTY_LANDING[value])
}
