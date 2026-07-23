// Oracle process (acts as oracleParty). Separate process + party from the scheduler:
// it is the ONLY writer of PriceObservation, so settlement reads a number the
// operator did not mint. SIMULATED/self-operated; labeled in UI and README.
import { runOracle } from '@/features/oracle-poller/loop'
import { oracleConfigFromEnv } from '@/features/oracle-poller/observation-writer'
import { sessionFromEnv } from './session-from-env'

const ac = new AbortController()
process.on('SIGINT', () => ac.abort())
process.on('SIGTERM', () => ac.abort())

const session = sessionFromEnv()
const cfg = oracleConfigFromEnv()
console.error(
  `overwrite oracle up: oracle=${cfg.oracle} poll=${cfg.pollMs}ms demo=${cfg.demoPrice ?? 'off'}`,
)
await runOracle(session, cfg, ac.signal, (price, isDemo, written) => {
  if (written) console.error(`[oracle] published ${price}${isDemo ? ' (DEMO)' : ''}`)
})
