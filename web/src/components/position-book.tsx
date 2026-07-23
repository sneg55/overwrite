// The vault position table. Extracted from the position page, which had grown past the
// file-size limit doing three jobs at once: fetching, deciding who sees what, and
// rendering. The page still owns the reads and the role decisions; this owns the table.
//
// Two shapes, one component. The operator sees the book grouped by depositor, because
// each deposit is its own contract and a depositor's own total is otherwise something
// you add up by hand. Everyone else sees a flat list, since they only ever have one name
// in the table and grouping would be scaffolding around a single row.

import { TableScroll } from '@/components/table-scroll'
import { WithdrawToggle } from '@/components/withdraw-toggle'
import { formatCbtc, formatEpoch } from '@/lib/format'
import type { DepositorGroup } from '@/lib/join'
import type { Party } from '@/lib/parties'
import type { PositionView } from '@/lib/types'

interface PositionBookProps {
  label: string
  rows: PositionView[]
  /** Non-empty only for the operator, whose book holds more than one depositor. */
  groups: DepositorGroup[]
  /**
   * Per depositor, how many rows that depositor's OWN party-scoped session returns.
   * Null when that read failed, which renders as unknown rather than as zero: reporting
   * zero for a read that never answered would turn an outage into a privacy claim.
   */
  mirror: Map<string, number | null>
  party: Party
  showDepositor: boolean
}

function PositionRow({
  p,
  party,
  showDepositor,
}: {
  p: PositionView
  party: Party
  showDepositor: boolean
}) {
  return (
    <tr>
      {showDepositor && <td className="party-cell">{p.depositor}</td>}
      <td className="num">{formatCbtc(p.principalCbtc)}</td>
      <td className="num">{formatEpoch(p.epochNumber)}</td>
      <td>
        <WithdrawToggle
          positionCid={p.contractId}
          queued={p.withdrawQueued}
          owned={p.depositor === party}
        />
      </td>
    </tr>
  )
}

export function PositionBook({
  label,
  rows,
  groups,
  mirror,
  party,
  showDepositor,
}: PositionBookProps) {
  const grouped = groups.length > 0
  const total = rows.reduce((sum, p) => sum + p.principalCbtc, 0)

  return (
    <TableScroll label={label}>
      <table>
        <thead>
          <tr>
            {showDepositor && <th scope="col">Depositor</th>}
            <th className="num" scope="col">
              Principal
            </th>
            <th className="num" scope="col">
              Epoch
            </th>
            <th scope="col">Withdrawal</th>
          </tr>
        </thead>

        {grouped ? (
          groups.map((g) => {
            const seen = mirror.get(g.depositor)
            return (
              <tbody key={g.depositor}>
                {g.rows.map((p) => (
                  <PositionRow key={p.contractId} p={p} party={party} showDepositor={true} />
                ))}
                <tr className="row-subtotal">
                  <th scope="row">{g.depositor} total</th>
                  <td className="num">{formatCbtc(g.totalCbtc)}</td>
                  <td className="mirror-cell" colSpan={2}>
                    {seen === null || seen === undefined
                      ? 'Their own view could not be read'
                      : `Their own session returns ${seen} of ${rows.length} rows`}
                  </td>
                </tr>
              </tbody>
            )
          })
        ) : (
          <tbody>
            {rows.map((p) => (
              <PositionRow key={p.contractId} p={p} party={party} showDepositor={showDepositor} />
            ))}
          </tbody>
        )}

        {/* Each deposit is its own contract, so the book fragments and the rows alone
            never state the pooled total. Only rendered on a book showing a depositor
            column, where the first cell is a natural row header. A depositor's own page
            already carries their total in the "Your total in the vault" stat above the
            deposit form, so a second one here would just be a louder duplicate. */}
        {showDepositor && rows.length > 1 && (
          <tfoot>
            <tr>
              <th scope="row">All depositors</th>
              <td className="num">{formatCbtc(total)}</td>
              <td className="num" />
              <td />
            </tr>
          </tfoot>
        )}
      </table>
    </TableScroll>
  )
}
