// Honesty-rail labels as badges: SIMULATED market maker, oracle trust model, and
// "demo parameter" on any premium figure. Never an APY claim.
import type { ReactNode } from 'react'

type Tone = 'warn' | 'info' | 'muted'

export function Badge({ tone = 'muted', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}
