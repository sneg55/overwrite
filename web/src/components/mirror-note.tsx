// The label for the operator's mirror column. It is part of the feature, not
// decoration around it.
//
// Without it the column reads as the operator asserting what a depositor can see, which
// is worth very little. With it, it states exactly what was run and hands the reader a
// way to check it independently. security.md requires the privacy reveal to be real
// ledger visibility rather than an impersonation trick: the query behind this column is
// the same party-scoped read that depositor's own session issues, through the same code
// path, returning the ledger's own answer. Saying so is what keeps it honest.
//
// The panel is for legibility. Party switching remains the falsifiable proof. Neither
// carries the claim on its own, and this note must not imply the column does.
export function MirrorNote() {
  return (
    <p className="note note-inline">
      Each figure is a real party-scoped ledger query, run with that demo party&apos;s
      backend-custodial key. It is the same read that party&apos;s own session performs, not a
      filter over this page&apos;s data. Switch to any depositor to verify it independently.
    </p>
  )
}
