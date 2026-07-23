import { Badge } from '@/components/badge'
import { TableScroll } from '@/components/table-scroll'
import { formatEpoch, formatUsd } from '@/lib/format'
import type { EpochReportView } from '@/lib/types'

function outcome(path: EpochReportView['settlementPath']): string {
  if (path === 'ITM') return 'Exercised (ITM)'
  if (path === 'OTM') return 'Expired (OTM)'
  return 'Not recorded'
}

export function PremiumHistory({ reports }: { reports: EpochReportView[] }) {
  const total = reports.reduce((sum, r) => sum + r.totalPremiumUsdc, 0)
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
          {reports.map((r) => (
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
