// Loading placeholders. Each is sized to the layout it replaces, so the swap to real
// data does not shift the page. The bars themselves are decorative and hidden from
// assistive tech; the surrounding region carries the announcement instead.

export function SkeletonCard({ title, rows = 4 }: { title: string; rows?: number }) {
  return (
    <section className="card" aria-busy="true" aria-live="polite">
      <div className="card-head">
        <h2 className="card-title">{title}</h2>
      </div>
      <span className="sr-only">Loading {title.toLowerCase()} from the ledger</span>
      <div className="skeleton-stack" aria-hidden="true">
        {Array.from({ length: rows }, (_, i) => (
          // Array index key is fine here: a fixed-length decorative placeholder, never reordered.
          <div className="skeleton skeleton-row" key={i} />
        ))}
      </div>
    </section>
  )
}

export function SkeletonTiles({ count = 2 }: { count?: number }) {
  return (
    <div className="stat-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        // Array index key is fine here: a fixed-length decorative placeholder, never reordered.
        <div className="stat-tile" key={i}>
          <div className="skeleton skeleton-line" style={{ width: '45%' }} />
          <div className="skeleton skeleton-display" />
        </div>
      ))}
    </div>
  )
}

export function SkeletonHead() {
  return (
    <div className="page-head" aria-hidden="true">
      <div className="skeleton skeleton-line" style={{ width: '9rem', height: 'var(--text-lg)' }} />
      <div className="skeleton skeleton-line" style={{ width: '22rem' }} />
    </div>
  )
}
