'use client'

// The live countdown. The server renders a stable first value from serverNowMs; the
// client's first render (before the effect) also uses serverNowMs via initial state,
// so the hydrated markup matches the server exactly. After mount the effect reads the
// real clock and, unless the user prefers reduced motion, ticks once a second. Under
// reduced motion the value still refreshes on mount, it just does not animate per
// second. aria-live is off: a per-second live announcement would be hostile.

import { useEffect, useState } from 'react'
import { countdownFrom, formatCountdown } from '@/lib/countdown'

export function EpochCountdown({ expiryMs, serverNowMs }: { expiryMs: number; serverNowMs: number }) {
  const [nowMs, setNowMs] = useState(serverNowMs)

  useEffect(() => {
    setNowMs(Date.now())
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const id = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  return (
    <span className="countdown-value">
      <span className="sr-only">Time to expiry: </span>
      {formatCountdown(countdownFrom(nowMs, expiryMs))}
    </span>
  )
}
