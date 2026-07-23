// MM process (acts as mmBuyer). SIMULATED, labeled in UI/README/video. Separate
// process and party from the operator: the only caller of PayPremium.
import { mmConfigFromEnv } from '@/features/mm-simulator/buyer'
import { runMm } from '@/features/mm-simulator/loop'
import { sessionFromEnv } from './session-from-env'

const ac = new AbortController()
process.on('SIGINT', () => ac.abort())
process.on('SIGTERM', () => ac.abort())

const session = sessionFromEnv()
const cfg = mmConfigFromEnv()
console.error(`overwrite mm up (SIMULATED): mmBuyer=${cfg.mmBuyer} poll=${cfg.pollMs}ms`)
await runMm(session, cfg, ac.signal, (action, cid) => {
  console.error(`[mm] ${action} on ${cid.slice(0, 12)}`)
})
