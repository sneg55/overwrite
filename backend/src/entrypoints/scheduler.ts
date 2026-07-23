// Scheduler process (acts as operator). Singleton, authoritative: the only writer of
// Vault state, so there are no concurrent-submission races on the vault.
import { schedulerConfigFromEnv } from '@/features/epoch-scheduler/config'
import { makeFileEngineControl } from '@/features/epoch-scheduler/control-file'
import { runScheduler } from '@/features/epoch-scheduler/loop'
import { env } from '@/utils/env'
import { sessionFromEnv } from './session-from-env'

const ac = new AbortController()
process.on('SIGINT', () => ac.abort())
process.on('SIGTERM', () => ac.abort())

const session = sessionFromEnv()
const cfg = schedulerConfigFromEnv()
// This process is the status writer and the intent reader. The REST server holds the
// mirror image of the same handle over the same directory, which is the only thing the
// two share: an in-memory control object could never cross between them.
const control = makeFileEngineControl(env.ENGINE_CONTROL_DIR, cfg.tickMs)
console.error(
  `overwrite scheduler up: operator=${cfg.operator} epoch=${cfg.epochLengthMs}ms tick=${cfg.tickMs}ms control=${env.ENGINE_CONTROL_DIR}`,
)
await runScheduler(
  session,
  cfg,
  ac.signal,
  (action, dispatched) => {
    if (dispatched) console.error(`[scheduler] dispatched ${action}`)
  },
  control,
)
