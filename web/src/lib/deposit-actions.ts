'use server'

// Deposit into the active vault. Custodial demo: the acting party is read from the
// session and the backend adds the operator co-authority server-side. The REST route
// needs { vaultCid, cbtcCid }. The depositor cannot read the Vault (operator-only), so
// the active vault cid is resolved live from GET /current-vault right before the write,
// never pinned in an env var: Vault.Deposit is consuming, so the cid rotates on every
// deposit and any cached value is stale after one. That read also tells us whether the
// deposit window is Open, so a closed epoch fails with a clear message, not a raw reject.

import { revalidatePath } from 'next/cache'
import { compareDecimal } from './decimal'
import { readCurrentVault, writeAs } from './ledger-api'
import { getActingParty } from './party-session'

export interface DepositState {
  status: 'idle' | 'ok' | 'error'
  message: string
}

export async function submitDepositAction(_prev: DepositState, formData: FormData): Promise<DepositState> {
  const cbtcCid = formData.get('cbtcCid')
  if (typeof cbtcCid !== 'string' || cbtcCid === '') {
    return { status: 'error', message: 'Select a holding to deposit from.' }
  }
  const amountRaw = formData.get('amountCbtc')
  const amountCbtc = typeof amountRaw === 'string' ? amountRaw.trim() : ''
  if (amountCbtc === '' || compareDecimal(amountCbtc, '0') !== 1) {
    return { status: 'error', message: 'Enter a deposit amount greater than zero.' }
  }
  const party = await getActingParty()
  const vault = await readCurrentVault(party)
  if (!vault.ok) {
    return {
      status: 'error',
      message:
        vault.error === 'no active vault'
          ? 'No vault is accepting deposits right now.'
          : 'Cannot reach the vault right now. Try again in a moment.',
    }
  }
  if (vault.data.windowState !== 'Open') {
    return { status: 'error', message: `Deposits are closed for epoch #${vault.data.epochNumber}.` }
  }
  // The vault enforces its own minimum, but a rejection there surfaces as an opaque
  // HTTP 400 from the command submission. Check it here, where the bound is known and
  // the message can name it, so a sub-minimum amount fails with a reason instead of
  // "deposit failed".
  if (compareDecimal(amountCbtc, vault.data.minDepositCbtc) === -1) {
    return {
      status: 'error',
      message: `The vault's minimum deposit is ${vault.data.minDepositCbtc} CBTC.`,
    }
  }
  const result = await writeAs(party, 'deposit', {
    vaultCid: vault.data.contractId,
    cbtcCid,
    amountCbtc,
  })
  if (!result.ok) return { status: 'error', message: result.error }
  revalidatePath('/app/position')
  revalidatePath('/app')
  return { status: 'ok', message: 'Deposit submitted. Your position appears once the ledger confirms.' }
}
