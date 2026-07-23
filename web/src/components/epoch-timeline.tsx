import { EpochCountdown } from '@/components/epoch-countdown'
import { formatExpiry } from '@/lib/format'
import type { VaultView, VaultWindowView } from '@/lib/types'

// The lifecycle track reflects only what the ledger proves. An option's existence and
// state say whether a call is live or settled; the Vault's window state says whether
// deposits are still open. Neither is assumed when it cannot be read.
const STEPS = ['Deposits', 'Collateral locked', 'Call live', 'Settlement'] as const

/**
 * The step to mark current, or null when the state we would need is unknown.
 * Returning null rather than a default is the point: an unreadable option state
 * used to render as "Call live", which asserts a phase nobody observed.
 */
function currentIndex(
  optionState: VaultView['optionState'],
  windowState?: VaultWindowView['windowState'],
): number | null {
  if (optionState === 'unknown') return null
  // An open window means deposits are still being taken, whatever the option says.
  // Without this the track claimed deposits were closed while a depositor was
  // actively depositing into an open one.
  if (windowState === 'Open') return 0
  if (optionState === 'Settled') return 3
  return 2
}

export function EpochTimeline({
  epochNumber,
  expiryIso,
  optionState,
  windowState,
}: {
  epochNumber: number
  expiryIso: string
  optionState: VaultView['optionState']
  windowState?: VaultWindowView['windowState']
}) {
  const current = currentIndex(optionState, windowState)
  const expiryMs = Date.parse(expiryIso)
  const serverNowMs = Date.now()

  const stepClass = (i: number): string => {
    if (current === null) return 'timeline-step is-unknown'
    if (i < current) return 'timeline-step is-done'
    if (i === current) return 'timeline-step is-current'
    return 'timeline-step'
  }

  return (
    <div className="timeline">
      <ol className="timeline-track" aria-label={`Epoch ${epochNumber} lifecycle`}>
        {STEPS.map((label, i) => (
          <li key={label} className={stepClass(i)} aria-current={current === i ? 'step' : undefined}>
            <span className="timeline-dot" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ol>
      <div className="timeline-countdown">
        <span className="timeline-countdown-label">Expires in</span>
        <EpochCountdown expiryMs={expiryMs} serverNowMs={serverNowMs} />
        <span className="timeline-countdown-sub">
          at <time dateTime={expiryIso}>{formatExpiry(expiryIso)}</time>
        </span>
      </div>
    </div>
  )
}
