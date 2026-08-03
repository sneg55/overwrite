// The oracle's on-ledger write. The oracle party CREATES a PriceObservation (signed
// by oracleParty), which is the honest, labeled self-operated feed. It learns the
// live epoch by reading the Vault as operator (a custodial demo affordance: the
// oracle is not a Vault stakeholder). Settlement later reads this observation by cid
// with freshness + wrong-epoch guards, so no off-ledger number is trusted.

import { cmdId, type LedgerSession } from '@/services/ledger-client/session'
import { env } from '@/utils/env'

export interface OracleConfig {
  operator: string
  oracle: string
  pollMs: number
  demoPrice?: string
  demoLate?: string
  demoSwitchMs?: number
}

export function oracleConfigFromEnv(): OracleConfig {
  return {
    operator: env.OPERATOR_PARTY,
    oracle: env.ORACLE_PARTY,
    pollMs: env.ORACLE_POLL_MS,
    demoPrice: env.ORACLE_DEMO_PRICE,
    demoLate: env.ORACLE_DEMO_PRICE_LATE,
    demoSwitchMs: env.ORACLE_DEMO_SWITCH_MS,
  }
}

export async function currentEpoch(
  session: LedgerSession,
  cfg: OracleConfig,
): Promise<number | null> {
  const vaults = await session.query(cfg.operator, 'Vault', 'Vault')
  const v = vaults[0]
  if (v === undefined) return null
  const e = v.payload.epochNumber
  return typeof e === 'number' ? e : typeof e === 'string' ? Number(e) : Number.NaN
}

const ASSET = 'CBTC'

/**
 * This epoch's live observation, or null if the oracle has not written one yet.
 *
 * Matched on the feed label as well as the epoch: `Revise` carries price and time only,
 * so reusing a contract across the demo/live boundary would leave `source` and `isDemo`
 * describing a feed the price did not come from. A relabel is rare enough that paying one
 * extra contract for it is the right trade.
 */
function liveObservation(
  contracts: Awaited<ReturnType<LedgerSession['query']>>,
  epoch: number,
  isDemo: boolean,
): { contractId: string; observedAtMs: number } | null {
  let best: { contractId: string; observedAtMs: number } | null = null
  for (const c of contracts) {
    const p = c.payload
    if (p.asset !== ASSET) continue
    if (Number(p.epochNumber) !== epoch) continue
    if (p.isDemo !== isDemo) continue
    const observedAtMs = Date.parse(String(p.observedAt))
    if (Number.isNaN(observedAtMs)) continue
    if (best === null || observedAtMs > best.observedAtMs) {
      best = { contractId: c.contractId, observedAtMs }
    }
  }
  return best
}

/**
 * Publish the oracle's price for the live epoch: REVISE this epoch's observation if one
 * exists, otherwise create it.
 *
 * Revising rather than creating is what keeps the observation count at one per epoch.
 * Creating on every poll leaked a contract per poll, which at a 3s poll is 20 a minute,
 * and a long-running ledger crossed the JSON API's active-contracts ceiling: after that
 * every scheduler read failed and the vault froze. The template's `Revise` choice is
 * consuming and its comment says it exists so the superseded observation is archived and
 * the latest wins on-ledger, so this is the mechanism working as designed rather than a
 * new one.
 *
 * KNOWN RACE, and why it is acceptable: the settle step reads an observation by cid and
 * then submits, so a revise landing in that gap consumes the contract the submission
 * names and the command fails. Nothing settles at a wrong price, because the choice reads
 * the price from the contract it was handed and that contract no longer exists; the
 * scheduler simply dispatches again on its next tick against the fresher observation.
 * A submit takes a fraction of a poll interval, so a collision is unlikely and always
 * self-heals. The alternative, freezing the observation once it is old enough to settle,
 * trades this for an observation that can age past the vault's maxObservationAge while
 * the engine is paused, which fails settlement in a way that does NOT self-heal.
 */
export async function writeObservation(
  session: LedgerSession,
  cfg: OracleConfig,
  price: string,
  isDemo: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  const epoch = await currentEpoch(session, cfg)
  if (epoch === null || Number.isNaN(epoch)) return false

  const existing = liveObservation(
    await session.query(cfg.oracle, 'PriceObservation', 'PriceObservation'),
    epoch,
    isDemo,
  )
  if (existing !== null) {
    // Revise asserts the timestamp never goes backwards, so a clock that did would fail
    // the submission. Skip the write instead of spending a round trip on a known reject.
    if (existing.observedAtMs > now) return false
    await session.exercise({
      module: 'PriceObservation',
      template: 'PriceObservation',
      contractId: existing.contractId,
      choice: 'Revise',
      choiceArgument: { newPrice: price, newObservedAt: new Date(now).toISOString() },
      actAs: [cfg.oracle],
      commandId: cmdId('obs'),
    })
    return true
  }

  await session.create({
    module: 'PriceObservation',
    template: 'PriceObservation',
    createArguments: {
      oracleParty: cfg.oracle,
      operator: cfg.operator,
      asset: 'CBTC',
      epochNumber: String(epoch),
      price,
      source: isDemo ? 'demo-override' : 'public-spot',
      observedAt: new Date(now).toISOString(),
      isDemo,
    },
    actAs: [cfg.oracle],
    commandId: cmdId('obs'),
  })
  return true
}
