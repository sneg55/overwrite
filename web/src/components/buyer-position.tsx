// The market maker's own view of the call it bought.
//
// The MM is a CallOption signatory: it pays the premium, it allocates the strike cash,
// and it takes delivery of the collateral when the option finishes in the money. That is
// a real position on the ledger, and until now it had no screen. The vault dashboard
// showed the same contract from the writer's side, where premium is money collected and
// the collateral is something retained. From this side both signs are reversed, so
// reusing that copy would have told the buyer its own outflow was income.
//
// Every figure here comes off the CallOption the MM already observes. Nothing is derived
// from a price feed or a model: the strike cash is the notional times the strike, which
// is arithmetic on two fields of the contract, and the premium is the contract's own.

import { Badge } from '@/components/badge'
import { Card, Stat } from '@/components/card'
import { Note } from '@/components/states'
import { formatCbtc, formatEpoch, formatExpiry, formatUsd } from '@/lib/format'
import type { VaultView } from '@/lib/types'

// What the option's state means to the party that bought it, rather than to the writer.
const buyerStateLabel: Record<VaultView['optionState'], string> = {
  Written: 'Written, premium not yet paid',
  Active: 'Active, premium paid',
  Settled: 'Settled',
  unknown: 'Not stated on this contract',
}

export function BuyerPosition({ option }: { option: VaultView }) {
  const strikeCashUsd = option.notionalCbtc * option.strikeUsdPerCbtc
  const premiumPaid = option.optionState === 'Active' || option.optionState === 'Settled'

  return (
    <Card title="Your option" hint="Market maker (simulated)">
      <Stat
        label="Bought"
        value={`Call on ${formatCbtc(option.notionalCbtc)}, epoch ${formatEpoch(option.epochNumber)}`}
      />
      <Stat
        label="Status"
        value={
          <>
            {buyerStateLabel[option.optionState]} <Badge tone="warn">MM simulated</Badge>
          </>
        }
      />
      {/* Named by direction, not by amount. "Premium" alone is the field both sides
          share and the one figure whose sign flips between them. */}
      <Stat
        label={premiumPaid ? 'Premium you paid' : 'Premium you owe'}
        value={
          <>
            {formatUsd(option.premiumUsdc)} <Badge tone="muted">demo parameter</Badge>
          </>
        }
      />
      <Stat label="Strike" value={`${formatUsd(option.strikeUsdPerCbtc)} / CBTC`} />
      {/* The cash this party has to have allocated to take delivery. It is the obligation
          the option creates for the buyer, and it never appeared anywhere in the product. */}
      <Stat label="Cash to allocate if exercised" value={formatUsd(strikeCashUsd)} />
      <Stat
        label="Expiry"
        value={<time dateTime={option.expiryIso}>{formatExpiry(option.expiryIso)}</time>}
      />
      <Stat label="Collateral held against this call" value={formatCbtc(option.notionalCbtc)} />
      <Note>
        The vault&apos;s collateral is locked on-chain as a CIP-56 registry allocation for the life
        of this option, so you carry no unsecured exposure to the vault. At expiry the option
        exercises only when the settlement price is above the strike, and the swap of collateral for
        strike cash settles atomically in one transaction. This market maker is a simulated
        counterparty and its premium figures are demo parameters, not market pricing.
      </Note>
    </Card>
  )
}
