import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/badge'
import { BuyerPosition } from '@/components/buyer-position'
import { Card, Stat, StatTile } from '@/components/card'
import { EnginePanel } from '@/components/engine-panel'
import { EpochTimeline } from '@/components/epoch-timeline'
import { PremiumHistory } from '@/components/premium-history'
import { EmptyState, ErrorState, Note, NotVisible } from '@/components/states'
import { formatCbtc, formatEpoch, formatExpiry, formatUsd } from '@/lib/format'
import { ENGINE_ERROR_PARAM, readEngineStatus } from '@/lib/ledger-api'
import { reportsFor, vaultFor, windowStateFor } from '@/lib/ledger-view'
import { PARTY_LANDING, PARTY_ROLE, positionLabel } from '@/lib/parties'
import { getActingParty } from '@/lib/party-session'
import type { VaultView } from '@/lib/types'

const optionStateLabel: Record<'Written' | 'Active' | 'Settled' | 'unknown', string> = {
  Written: 'Written',
  Active: 'Active',
  Settled: 'Settled',
  unknown: 'Not stated on this contract',
}

const windowStateLabel: Record<'Open' | 'Locked' | 'Settling' | 'unknown', string> = {
  Open: 'Open',
  Locked: 'Locked',
  Settling: 'Settling',
  unknown: 'Not recorded',
}

/**
 * What this epoch is actually doing, derived rather than asserted. The subtitle used
 * to hardcode "Collateral is locked", which could sit directly above the
 * "Pooled, not yet covered" tile and contradict it. A party who cannot read the Vault
 * gets the sentence the option alone supports.
 */
function vaultSubtitle(vault: VaultView, window: Awaited<ReturnType<typeof windowStateFor>>): string {
  const expires = `The written call expires ${formatExpiry(vault.expiryIso)}.`
  if (vault.optionState === 'Settled') return 'This epoch has settled.'
  const windowState = window.ok && window.data !== null ? window.data.windowState : undefined
  if (windowState === 'Open') return `Deposits are open. ${expires}`
  return `Collateral is locked. ${expires}`
}

export const metadata: Metadata = { title: 'Vault' }

export default async function DashboardPage({
  searchParams,
}: {
  // Carries back a control click that never landed. The engine actions redirect here
  // rather than swallowing the failure, so the operator is never left looking at a
  // button that silently did nothing.
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const party = await getActingParty()
  // A depositor is not a stakeholder of the Vault or option, so `/` is always empty for
  // them. Land them on the page that shows their own data instead of an empty vault.
  const landing = PARTY_LANDING[party]
  if (landing !== '/app') redirect(landing)

  const result = await vaultFor(party)
  const window = await windowStateFor(party)
  const reports = await reportsFor(party)

  // The engine control surface is operator-only at the backend too, so this gate is the
  // UI declining to show a card whose every button would 403, not the access check.
  const isOperator = PARTY_ROLE[party] === 'Vault operator'
  // The market maker signs the same CallOption the operator writes, so it reads the same
  // contract from the opposite side of the trade.
  const isMarketMaker = PARTY_ROLE[party] === 'Market maker (simulated)'
  const engine = isOperator ? await readEngineStatus(party) : null
  const rawEngineError = (await searchParams)[ENGINE_ERROR_PARAM]
  const engineActionError = typeof rawEngineError === 'string' ? rawEngineError : null

  // Rendered on every branch below, including the ones where the option read failed or
  // showed nothing. Those are precisely the states in which an operator most wants to
  // halt the engine, so hiding the controls behind a successful read would withdraw them
  // exactly when they matter.
  const engineCard =
    engine === null ? null : !engine.ok ? (
      <Card title="Engine" hint="Operator control">
        <ErrorState detail={engine.error} />
      </Card>
    ) : (
      <Card title="Engine" hint="Operator control">
        <EnginePanel status={engine.data} actionError={engineActionError} />
        <Note>
          The scheduler drives every transition on a tick. Pausing stops it between ticks, never
          mid-transaction, so stepping is safe. It runs as its own process, so these controls reach
          it through a control file rather than a shared memory.
        </Note>
      </Card>
    )

  if (!result.ok) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Vault</h1>
        </div>
        <Card title="Current option">
          <ErrorState detail={result.error} />
        </Card>
        {engineCard}
      </>
    )
  }

  const vault = result.data

  if (vault === null) {
    // A null option reads differently by party: for the operator or the market maker
    // (both option stakeholders) it means no call is currently written; for anyone else
    // it means the ledger never showed them the option at all.
    const isOptionStakeholder = party === 'operator' || party === 'mm-buyer'
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">Vault</h1>
        </div>
        <Card title="Current option" hint={PARTY_ROLE[party]}>
          {isOptionStakeholder ? (
            <EmptyState title="No call written right now">
              The last epoch has settled, or none has been written yet. Deposits and premium history
              live on the {positionLabel(party).toLowerCase()} and settlement history pages.
            </EmptyState>
          ) : (
            <EmptyState title="No vault visible to this party">
              {/* Explicit {' '}: the JSX transform drops the leading space of a text node
                  that follows a closing tag, rendering "observeris not a stakeholder". */}
              <strong>{party}</strong>{' '}
              is not a stakeholder of the option contract, so the ledger returned nothing. This page
              was rendered on the server with that party&apos;s own read rights: the data was never
              sent to your browser and then hidden from you.
            </EmptyState>
          )}
        </Card>
        {engineCard}
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        {/* Names the destination, not just the epoch. The nav tab and the browser tab
            both say "Vault", so an H1 reading only "Epoch #3" never confirmed arrival. */}
        <h1 className="page-title">Vault, epoch {formatEpoch(vault.epochNumber)}</h1>
        <p className="page-subtitle">{vaultSubtitle(vault, window)}</p>
      </div>

      <Card title="Epoch timeline" hint={PARTY_ROLE[party]}>
        <EpochTimeline
          epochNumber={vault.epochNumber}
          expiryIso={vault.expiryIso}
          optionState={vault.optionState}
          windowState={window.ok && window.data !== null ? window.data.windowState : undefined}
        />
      </Card>

      {/* Directly under the timeline, because the timeline is the thing these buttons
          move. Reading the phase and changing it should not be two separate errands. */}
      {engineCard}

      <div className="stat-grid">
        {/* The option's notional, which is what this call actually covers. It was
            labelled "Collateral locked", which read as the vault's whole balance and so
            contradicted a depositor's own view after a mid-epoch deposit: their card
            said 1.5 CBTC locked while this tile still said 3. The landing page already
            calls this "Covered notional"; the app page was the inconsistent one. */}
        <StatTile label="Covered notional" value={formatCbtc(vault.notionalCbtc)} />
        {/* Scoped to this epoch. "Premium collected" sat on the same screen as the
            history table's "Premium paid out" total with nothing saying whether one
            figure was inside the other. */}
        <StatTile
          label="Premium this epoch"
          value={
            <>
              {formatUsd(vault.premiumUsdc)} <Badge tone="muted">demo parameter</Badge>
            </>
          }
        />
        {/* Pooled >= notional whenever the window has reopened, because a mid-epoch
            deposit joins the pool but is not covered until the next call is written.
            Showing only the notional left that difference invisible and made the
            depositor's own "locked as collateral" figure look like a contradiction.
            The Vault is operator-only, so this is null for everyone else. */}
        {window.ok && window.data !== null && window.data.pooledCbtc > vault.notionalCbtc && (
          <StatTile
            label="Pooled, not yet covered"
            value={formatCbtc(window.data.pooledCbtc - vault.notionalCbtc)}
          />
        )}
      </div>

      {/* One contract, two sides. The market maker gets its own card rather than this
          one, because "Written call" is the writer's framing of the very same option and
          every signed figure on it points the wrong way for the party that bought it.
          Showing both would put the same premium on one page twice with opposite signs. */}
      {isMarketMaker ? (
        <BuyerPosition option={vault} />
      ) : (
        <Card title="Written call" hint={PARTY_ROLE[party]}>
          <Stat label="Strike" value={`${formatUsd(vault.strikeUsdPerCbtc)} / CBTC`} />
          <Stat
            label="Option status"
            value={
              <>
                {optionStateLabel[vault.optionState]} <Badge tone="warn">MM simulated</Badge>
              </>
            }
          />
          {/* Rendered for every party. The Vault is operator-only, so for anyone else this
              row says so rather than disappearing: an omitted row cannot be told apart from
              data that does not exist. */}
          <Stat
            label="Deposit window"
            value={
              window.ok && window.data !== null ? (
                windowStateLabel[window.data.windowState]
              ) : (
                <NotVisible />
              )
            }
          />
          <Stat label="Expiry" value={<time dateTime={vault.expiryIso}>{formatExpiry(vault.expiryIso)}</time>} />
          <Stat label="Collateral" value="Locked as a CIP-56 registry allocation" />
          <Stat
            label="Settlement price"
            value={
              <>
                Self-operated spot feed <Badge tone="warn">Price feed simulated</Badge>
              </>
            }
          />
          <Note>
            Collateral stays locked on-chain for the life of the option, so the buyer carries no
            unsecured exposure to this vault. Premium figures are demo parameters, not market pricing.
          </Note>
        </Card>
      )}

      <Card title="Premium history" hint={PARTY_ROLE[party]}>
        {!reports.ok ? (
          <ErrorState detail={reports.error} />
        ) : reports.data.length === 0 ? (
          <EmptyState title="No settled epochs visible to this party">
            Reports go to the operator and to the depositors who took part in an epoch. Anyone else
            is a stakeholder of none.
          </EmptyState>
        ) : (
          <>
            <PremiumHistory reports={reports.data} />
            <Note>
              Each figure is the total premium paid out that epoch, a demo parameter, not market
              pricing. Settled epochs only: the epoch in progress is not counted here. Who received
              what stays on the individual receipts.
            </Note>
          </>
        )}
      </Card>
    </>
  )
}
