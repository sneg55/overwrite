// Self-operated oracle price source (spike 0.4 fallback, and the expected plan).
//
// Fetches BTC/USD spot from public APIs and normalizes it. The oracle party then
// writes this into a `PriceObservation` on the ledger (that write lives elsewhere;
// it needs the JSON Ledger API). Multiple sources are tried in order for
// resilience; the first that parses wins. The trust model (self-operated, public
// spot) is labeled in the UI and README per the honesty rails.
//
// Parsing goes through Zod so a shape change in a third-party API surfaces as a
// clean parse failure, not an unsafe field access (zod-at-the-boundary).

import { z } from 'zod'
import { AppError, ErrorIds } from '@/constants/errorIds'

export interface SpotPrice {
  asset: 'BTC'
  priceUsd: number
  source: string
  observedAt: string
}

const coinbaseSchema = z.object({ data: z.object({ amount: z.string() }) })
const coingeckoSchema = z.object({ bitcoin: z.object({ usd: z.number() }) })

export function parseCoinbase(json: unknown): number | null {
  const parsed = coinbaseSchema.safeParse(json)
  if (!parsed.success) return null
  const amount = Number(parsed.data.data.amount)
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

export function parseCoinGecko(json: unknown): number | null {
  const parsed = coingeckoSchema.safeParse(json)
  if (!parsed.success) return null
  const amount = parsed.data.bitcoin.usd
  return Number.isFinite(amount) && amount > 0 ? amount : null
}

interface PriceSource {
  label: string
  url: string
  parse: (json: unknown) => number | null
}

const SOURCES: readonly PriceSource[] = [
  {
    label: 'coinbase',
    url: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
    parse: parseCoinbase,
  },
  {
    label: 'coingecko',
    url: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd',
    parse: parseCoinGecko,
  },
] as const

const REQUEST_TIMEOUT_MS = 10_000

async function tryFetch(source: PriceSource, signal?: AbortSignal): Promise<number | null> {
  try {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
    const res = await fetch(source.url, { signal: combined })
    if (!res.ok) return null
    return source.parse(await res.json())
  } catch {
    // A single source failing is expected; the caller falls through to the next.
    return null
  }
}

/**
 * Fetch BTC/USD spot, trying each source in order. Throws `ORCL_FETCH_FAIL` only if
 * every source fails, so a single flaky provider does not stop the oracle.
 */
export async function fetchBtcSpot(signal?: AbortSignal): Promise<SpotPrice> {
  const tried: string[] = []
  for (const source of SOURCES) {
    tried.push(source.label)
    const priceUsd = await tryFetch(source, signal)
    if (priceUsd !== null) {
      return {
        asset: 'BTC',
        priceUsd,
        source: source.label,
        observedAt: new Date().toISOString(),
      }
    }
  }
  throw new AppError(ErrorIds.ORCL_FETCH_FAIL, 'all BTC spot sources failed', {
    sources: tried,
  })
}
