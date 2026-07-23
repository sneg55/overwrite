import type { ReactNode } from 'react'

// A horizontally scrollable region with no focusable children cannot be scrolled by
// keyboard alone. Making it a focusable, labelled region restores that (WCAG 2.1.1).
// The focus ring is the global :focus-visible box-shadow.
export function TableScroll({ label, children }: { label: string; children: ReactNode }) {
  return (
    // The tabIndex is intentional: a scroll container needs keyboard focus so an
    // overflowing region is reachable without a pointer (see the WCAG note above).
    <div aria-label={label} className="table-scroll" role="region" tabIndex={0}>
      {children}
    </div>
  )
}
