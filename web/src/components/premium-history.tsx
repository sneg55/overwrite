import { Badge } from '@/components/badge'
import { TableScroll } from '@/components/table-scroll'
import { formatEpoch, formatUsd } from '@/lib/format'
import { dedupeReportsByEpoch } from '@/lib/join'
import type { EpochReportView } from '@/lib/types'

function outcome(path: EpochReportView['settlementPath']): string {
  if (path === 'ITM') return 'Exercised (ITM)'
  if (path === 'OTM') return 'Expired (OTM)'
  return 'Not recorded'
}

// The ledger issues one EpochReport per depositor and every copy carries the SAME
// aggregate, so a stakeholder who observes several of them (the operator observes all of
// an epoch's copies) reads the same epoch back N times. Summing that raw list multiplied
// the headline premium by the depositor count: on the live demo three depositors turned
// three settled epochs at $1,915 into a reported $17,234. Overstating the one figure this
// project is careful never to overstate is the real defect; the repeated rows were only
// what made it visible.
//
// Deduped HERE rather than at the call site because the row key is the epoch number, so
// this component is already relying on one row per epoch. `joinReceiptsToReports` applies
// the same collapse for the settlement history page, which is why that page was correct
// and this card was not.
export function PremiumHistory({ reports }: { reports: EpochReportView[] }) {
  const rows = dedupeReportsByEpoch(reports)
  const total = rows.reduce((sum, r) => sum + r.totalPremiumUsdc, 0)
  return (
    <TableScroll label="Premium history">
      <table>
        <thead>
          <tr>
            <th className="num" scope="col">
              Epoch
            </th>
            <th className="num" scope="col">
              Premium paid out
            </th>
            <th scope="col">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.epochNumber}>
              <td className="num">{formatEpoch(r.epochNumber)}</td>
              <td className="num">
                {formatUsd(r.totalPremiumUsdc)} <Badge tone="muted">demo parameter</Badge>
              </td>
              <td>{outcome(r.settlementPath)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="num">Total</td>
            <td className="num">{formatUsd(total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </TableScroll>
  )
}
