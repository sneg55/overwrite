import type { Metadata } from 'next'
import { Card, Stat } from '@/components/card'
import { DepositForm } from '@/components/deposit-form'
import { MirrorNote } from '@/components/mirror-note'
import { PositionBook } from '@/components/position-book'
import { EmptyState, ErrorState, Note } from '@/components/states'
import { TableScroll } from '@/components/table-scroll'
import { formatCbtc, formatEpoch, formatUsd } from '@/lib/format'
import { groupByDepositor, needsDepositorColumn } from '@/lib/join'
import { readCurrentVault } from '@/lib/ledger-api'
import { holdingsFor, positionsFor, receiptsFor } from '@/lib/ledger-view'
import { isParty, PARTY_ROLE, positionLabel } from '@/lib/parties'
import { getActingParty } from '@/lib/party-session'

// The tab title tracks the same read-as-who rule the H1 and the nav tab use.
export async function generateMetadata(): Promise<Metadata> {
  return { title: positionLabel(await getActingParty()) }
}

export default async function PositionPage() {
  const party = await getActingParty()
  const positions = await positionsFor(party)
  const receipts = await receiptsFor(party)
  const holdings = await holdingsFor(party)
  // The vault's own deposit rule, so the form can refuse a sub-minimum amount with a
  // reason instead of letting it fail at the ledger as an opaque command rejection.
  // A failed read leaves it undefined and the form asserts no minimum rather than
  // inventing one.
  const currentVault = await readCurrentVault(party)
  const minDepositCbtc = currentVault.ok ? currentVault.data.minDepositCbtc : undefined
  // Vault.daml refuses a deposit unless the window is Open (Vault.daml:56), the guard
  // immediately above the minimum one. A failed read leaves this undefined and the form
  // asserts nothing.
  const windowState = currentVault.ok ? currentVault.data.windowState : undefined
  const role = PARTY_ROLE[party]
  const isDepositor = role === 'Depositor'
  const isOperator = role === 'Vault operator'
  // Computed only from an ok read, so a backend outage never masquerades as an empty
  // wallet. The deposit form chooses a holding by balance, never by cid, and surfaces
  // the available balance itself; there is no separate wallet card to duplicate it.
  const wallet = holdings.ok ? holdings.data : []
  // The depositor's collateral already locked, for the deposit form's before/after row.
  // Positions are party-scoped by the ledger; the filter is belt-and-suspenders.
  const myPositions = positions.ok ? positions.data.filter((p) => p.depositor === party) : []
  const currentPrincipal = myPositions.reduce((sum, p) => sum + p.principalCbtc, 0)
  const currentEpoch = myPositions[0]?.epochNumber

  // The depositor column only earns its width when there is more than one name to tell
  // apart. On a depositor's own page every row is theirs, so it repeats one name down
  // the table. See needsDepositorColumn for why this asks the rows, not the role.
  const showPositionDepositor = positions.ok && needsDepositorColumn(positions.data, party)
  const showReceiptDepositor = receipts.ok && needsDepositorColumn(receipts.data, party)

  const title = positionLabel(party)
  const positionsTitle = isDepositor ? 'Your vault positions' : 'Depositor positions'
  const premiumTitle = isDepositor ? 'Premium received' : 'Premium paid'

  // The operator's book, grouped so each depositor's own total is readable without
  // adding rows by hand. Only the operator sees more than one depositor, so only their
  // page needs it.
  const groups = isOperator && positions.ok ? groupByDepositor(positions.data) : []

  // The privacy reveal, done as a real query rather than an assertion.
  //
  // For each depositor in the book, this issues the SAME party-scoped read that
  // depositor's own session issues (readAs sends their demo bearer token, which the
  // backend binds to their real party id) and records how many rows come back. It is
  // deliberately NOT a filter over `positions.data`: filtering would render identical
  // numbers while proving nothing, because the claim being made is about what the
  // LEDGER returns for that party, not about what this page can compute. See
  // security.md, which requires the reveal to be real ledger visibility.
  //
  // A failed read stays null and renders as unknown. Reporting 0 for a read that never
  // answered would turn an outage into a privacy claim, which is the same mistake
  // states.tsx exists to prevent.
  const mirror = new Map<string, number | null>()
  for (const g of groups) {
    if (!isParty(g.depositor)) {
      mirror.set(g.depositor, null)
      continue
    }
    const own = await positionsFor(g.depositor)
    mirror.set(g.depositor, own.ok ? own.data.length : null)
  }

  // Neither a depositor nor the operator is a stakeholder of any position or receipt,
  // so both cards below would render the same empty state as the subtitle. Say it once.
  if (!isDepositor && !isOperator) {
    return (
      <>
        <div className="page-head">
          <h1 className="page-title">{title}</h1>
        </div>
        <Card title="Positions" hint={role}>
          <EmptyState title="No positions held by this party">
            Read from the ledger as <strong>{party}</strong>, who is a stakeholder of no vault
            position and no premium receipt. This page was rendered on the server with that
            party&apos;s own read rights: the data was never sent to your browser and then hidden
            from you.
          </EmptyState>
        </Card>
      </>
    )
  }

  return (
    // The depositor view is a single-column form-plus-facts page, so it reads best as a
    // narrow centered column the width of the deposit box, not stretched across the full
    // 960px main. The operator view holds the wide depositor book, so it keeps full width.
    <div className={isDepositor ? 'position-column narrow-column' : 'position-column'}>
      <div className="page-head">
        <h1 className="page-title">{title}</h1>
        <p className="page-subtitle">
          {isDepositor ? (
            <>
              Read from the ledger as <strong>{party}</strong>. You see your own deposit and your own
              premium, and no other depositor&apos;s.
            </>
          ) : (
            // Not a depositor means the operator: the non-stakeholder case already
            // returned above, so this branch is the full-book reader.
            <>
              The full depositor book, read from the ledger as <strong>{party}</strong>, who is a
              signatory on every position and so sees them all. Depositors queue their own
              withdrawals; they appear here as status only.
            </>
          )}
        </p>
      </div>

      {isDepositor && (
        <Card title="Deposit CBTC">
          {/* The depositor's total lives on the page, not inside the form. The form
              early-returns on an empty wallet, and when it did so it took the only copy
              of this figure with it: a depositor who had deposited everything saw no
              total anywhere. The table footer is suppressed on a depositor's own page
              precisely because this exists, so it has to survive the form's empty path. */}
          <Stat label="Your total in the vault" value={formatCbtc(currentPrincipal)} />
          {!holdings.ok ? (
            <ErrorState detail={holdings.error} />
          ) : (
            <DepositForm
              holdings={wallet}
              principalCbtc={currentPrincipal}
              epochNumber={currentEpoch}
              minDepositCbtc={minDepositCbtc}
              windowState={windowState}
            />
          )}
          <Note>
            Demo accounts are backend-custodied and seed-funded. Balances are not market amounts.
          </Note>
        </Card>
      )}

      <Card title={positionsTitle}>
        {!positions.ok ? (
          <ErrorState detail={positions.error} />
        ) : positions.data.length === 0 ? (
          <EmptyState title="No positions held by this party">
            The ledger returned no vault position for <strong>{party}</strong>. A depositor holds
            one position per deposit, so several can share an epoch. The operator, the market
            maker, and any observer hold none.
          </EmptyState>
        ) : (
          <>
            <PositionBook
              label={positionsTitle}
              rows={positions.data}
              groups={groups}
              mirror={mirror}
              party={party}
              showDepositor={showPositionDepositor}
            />
            {groups.length > 0 && <MirrorNote />}
          </>
        )}
      </Card>

      <Card title={premiumTitle}>
        {!receipts.ok ? (
          <ErrorState detail={receipts.error} />
        ) : receipts.data.length === 0 ? (
          // Why the list is empty depends on who is asking. A depositor simply has not been
          // paid yet; anyone else holds no receipts because receipts are per-depositor by
          // construction. Explaining privacy to a depositor would read as a deflection.
          isDepositor ? (
            <EmptyState title="No premium paid to you yet">
              Premium arrives when an epoch settles, as a transfer plus a receipt that only you can
              read. Nothing accrues in the meantime.
            </EmptyState>
          ) : (
            <EmptyState title="No premium receipts held by this party">
              Premium is paid per depositor, and each receipt is visible only to the depositor who
              received it. No party can enumerate another party&apos;s payouts.
            </EmptyState>
          )
        ) : (
          <>
            <TableScroll label={premiumTitle}>
              <table>
                <thead>
                  <tr>
                    {showReceiptDepositor && <th scope="col">Depositor</th>}
                    <th className="num" scope="col">
                      Epoch
                    </th>
                    <th className="num" scope="col">
                      Premium
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {receipts.data.map((r) => (
                    <tr key={`${r.depositor}-${r.epochNumber}`}>
                      {showReceiptDepositor && <td className="party-cell">{r.depositor}</td>}
                      <td className="num">{formatEpoch(r.epochNumber)}</td>
                      <td className="num">{formatUsd(r.premiumPaidUsdc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <Note>
              Premium amounts are demo parameters, not market pricing, and payouts settle in a
              demo-only mock USDC instrument.
            </Note>
          </>
        )}
      </Card>
    </div>
  )
}
