// The report view co-locates the aggregate EpochReport (visible to every epoch
// depositor) with the viewer's own PremiumReceipt (visible only to that depositor).
// The join is a pure client-of-the-ledger operation over two already party-scoped
// lists: it reveals nothing new, it only puts the viewer's own number next to the
// aggregate.
//
// The ledger issues one EpochReport per depositor, and every copy for an epoch carries
// the same aggregate. A stakeholder who observes several of them (the operator observes
// all of an epoch's copies) would otherwise see the same aggregate repeated, so
// dedupeReportsByEpoch collapses them to the one-per-epoch row the page promises.
//
// "Your premium" is the viewer's OWN receipt, so a receipt counts only if its depositor
// is the acting party. The operator observes every depositor's receipt but holds none
// of its own, so it gets null (not an arbitrary depositor's number).

import type { Party } from './parties'
import type { EpochReportView, PositionView, ReceiptView } from './types'

export interface ReportRow extends EpochReportView {
  ownReceiptUsdc: number | null
}

// Whether a table of party-scoped rows needs its "Depositor" column. On a depositor's
// own page every row is theirs, so the column only repeats one name down the table.
//
// This asks the rows, not the viewer's role, and that is the point: the column is what
// tells a reader which row belongs to whom, so it may only be dropped when there is
// provably nothing to disambiguate. A single foreign row brings it back.
export function needsDepositorColumn(rows: { depositor: string }[], party: Party): boolean {
  return rows.some((r) => r.depositor !== party)
}

/** A depositor's rows in the operator's book, with their pooled total. */
export interface DepositorGroup {
  depositor: string
  rows: PositionView[]
  totalCbtc: number
}

// Group the operator's book by depositor. Each deposit is its own contract, so one
// depositor holds one row per deposit and the book fragments: the rows give individual
// deposits and the footer gives a grand total, with nothing in between. The one figure
// an operator actually wants, what any given depositor holds, had to be added up by hand.
//
// Insertion-ordered so the table's row order stays stable across renders rather than
// reordering on a Map's iteration whim.
export function groupByDepositor(rows: PositionView[]): DepositorGroup[] {
  const byDepositor = new Map<string, DepositorGroup>()
  for (const r of rows) {
    const g = byDepositor.get(r.depositor)
    if (g === undefined) {
      byDepositor.set(r.depositor, { depositor: r.depositor, rows: [r], totalCbtc: r.principalCbtc })
    } else {
      g.rows.push(r)
      g.totalCbtc += r.principalCbtc
    }
  }
  return [...byDepositor.values()]
}

// One row per settled epoch. Per-depositor copies carry an identical aggregate, so
// keeping the first seen loses nothing.
export function dedupeReportsByEpoch(reports: EpochReportView[]): EpochReportView[] {
  const byEpoch = new Map<number, EpochReportView>()
  for (const r of reports) {
    if (!byEpoch.has(r.epochNumber)) byEpoch.set(r.epochNumber, r)
  }
  return [...byEpoch.values()]
}

export function joinReceiptsToReports(
  reports: EpochReportView[],
  receipts: ReceiptView[],
  party: Party,
): ReportRow[] {
  // Only the acting party's own receipt is "yours". A party with no receipt for an
  // epoch gets null, not zero.
  const mine = new Map<number, number>()
  for (const r of receipts) {
    if (r.depositor === party) mine.set(r.epochNumber, r.premiumPaidUsdc)
  }
  return dedupeReportsByEpoch(reports).map((r) => ({
    ...r,
    ownReceiptUsdc: mine.has(r.epochNumber) ? (mine.get(r.epochNumber) as number) : null,
  }))
}
