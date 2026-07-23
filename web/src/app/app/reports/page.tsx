import type { Metadata } from 'next'
import { Badge } from '@/components/badge'
import { Card } from '@/components/card'
import { EmptyState, ErrorState, Note } from '@/components/states'
import { TableScroll } from '@/components/table-scroll'
import { formatCbtc, formatEpoch, formatUsd } from '@/lib/format'
import { joinReceiptsToReports } from '@/lib/join'
import { receiptsFor, reportsFor } from '@/lib/ledger-view'
import { PARTY_ROLE } from '@/lib/parties'
import { getActingParty } from '@/lib/party-session'

/**
 * The settlement outcome, including what happened to the collateral. These were two
 * columns encoding one bit: ITM always delivers and OTM always returns, so the second
 * column never carried information the first did not.
 */
function outcome(
  path: 'OTM' | 'ITM' | 'unknown',
  collateralReturned: boolean,
): { tone: 'info' | 'muted'; label: string } {
  if (path === 'ITM') {
    return {
      tone: 'info',
      label: `Exercised (ITM) · ${collateralReturned ? 'returned' : 'delivered'}`,
    }
  }
  if (path === 'OTM') {
    return {
      tone: 'muted',
      label: `Expired (OTM) · ${collateralReturned ? 'returned' : 'delivered'}`,
    }
  }
  return { tone: 'muted', label: 'Not recorded' }
}

/**
 * A figure the report may not carry. Reports written before overwrite-vault 1.1.0
 * have no settlement price, and saying so is the honest render. Rendering $0 would
 * state a price nobody observed, which is the defect class this whole pass removes.
 */
function optionalUsd(value: number | null): string {
  return value === null ? 'Not recorded' : formatUsd(value)
}

export const metadata: Metadata = { title: 'Settlement history' }

export default async function ReportsPage() {
  const party = await getActingParty()
  const reports = await reportsFor(party)
  const receipts = await receiptsFor(party)
  const isDepositor = PARTY_ROLE[party] === 'Depositor'
  // Asks whether the viewer holds a receipt of their OWN, not whether they can see any.
  // The operator is signatory on every PremiumReceipt and so reads back the whole book,
  // which makes a plain length check true for the one party this column most needs to be
  // hidden from. This is the rule joinReceiptsToReports already uses to fill
  // ownReceiptUsdc, so the column now exists exactly when a row in it can be non-null.
  const holdsReceipts = receipts.ok && receipts.data.some((r) => r.depositor === party)

  return (
    <>
      <div className="page-head">
        <h1 className="page-title">Settlement history</h1>
        <p className="page-subtitle">
          {isDepositor ? (
            <>
              One aggregate report per settled epoch, alongside your own premium receipt for it. The
              report carries no per-depositor payout list, and your receipt is visible only to you.
            </>
          ) : (
            <>
              One aggregate report per settled epoch. The report carries a depositor count and
              aggregate totals, and no per-depositor payout list. Individual receipts are visible
              only to the depositor who received them.
            </>
          )}
        </p>
      </div>

      <Card title="Settled epochs" hint={PARTY_ROLE[party]}>
        {!reports.ok ? (
          <ErrorState detail={reports.error} />
        ) : reports.data.length === 0 ? (
          <EmptyState title="No settled epochs yet">
            A report is written when an epoch settles, so an epoch still running has none. Reports go
            to the operator and to the depositors who took part in that epoch.
          </EmptyState>
        ) : (
          <TableScroll label="Settled epochs">
            <table>
              <thead>
                <tr>
                  <th className="num" scope="col">
                    Epoch
                  </th>
                  <th scope="col">Outcome</th>
                  <th className="num" scope="col">
                    Settlement
                  </th>
                  <th className="num" scope="col">
                    Strike
                  </th>
                  <th className="num" scope="col">
                    Premium
                  </th>
                  {/* Only for a party that actually holds receipts. Filling this with
                      "None" down every row for the operator read as "you were paid
                      nothing" when it meant "this column is not about you". */}
                  {holdsReceipts && (
                    <th className="num" scope="col">
                      Your premium
                    </th>
                  )}
                  <th className="num" scope="col">
                    Notional
                  </th>
                  <th className="num" scope="col">
                    Depositors
                  </th>
                </tr>
              </thead>
              <tbody>
                {joinReceiptsToReports(reports.data, receipts.ok ? receipts.data : [], party).map((r) => {
                  const o = outcome(r.settlementPath, r.collateralReturned)
                  return (
                    <tr key={r.epochNumber}>
                      <td className="num">{formatEpoch(r.epochNumber)}</td>
                      <td>
                        <Badge tone={o.tone}>{o.label}</Badge>
                      </td>
                      <td className="num">{optionalUsd(r.observedPrice)}</td>
                      <td className="num">{optionalUsd(r.strikeUsdcPerCbtc)}</td>
                      <td className="num">{formatUsd(r.totalPremiumUsdc)}</td>
                      {holdsReceipts && (
                        <td className="num">
                          {r.ownReceiptUsdc === null ? 'None' : formatUsd(r.ownReceiptUsdc)}
                        </td>
                      )}
                      <td className="num">{formatCbtc(r.totalNotionalCbtc)}</td>
                      <td className="num">{r.depositorCount}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </TableScroll>
        )}
        {/* The note describes the table above it, so it only belongs with a table. Under an
            empty or errored state it would be annotating rows that are not there. */}
        {reports.ok && reports.data.length > 0 && (
          <Note>
            The report reveals a depositor count and nothing more about who they are. Your own
            premium is read from your own receipt and shown to nobody else. The settlement price
            against the strike is what decided each outcome. Premium and strike figures are demo
            parameters, not market pricing.
          </Note>
        )}
      </Card>
    </>
  )
}
