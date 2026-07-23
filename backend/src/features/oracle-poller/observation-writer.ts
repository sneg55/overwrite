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

export async function writeObservation(
  session: LedgerSession,
  cfg: OracleConfig,
  price: string,
  isDemo: boolean,
  now: number = Date.now(),
): Promise<boolean> {
  const epoch = await currentEpoch(session, cfg)
  if (epoch === null || Number.isNaN(epoch)) return false
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
