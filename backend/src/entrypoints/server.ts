// Process entrypoint for the REST API. Wires the env boundary to the server, and
// builds a live LedgerGateway only when OIDC credentials are configured.
import { makeFileEngineControl } from '@/features/epoch-scheduler/control-file'
import { LedgerGateway } from '@/features/rest-api/gateway'
import { startServer } from '@/features/rest-api/server'
import { env } from '@/utils/env'

function buildGateway(): LedgerGateway | undefined {
  // Local sandbox: no-auth gateway, user-id supplied in command bodies.
  if (env.LEDGER_LOCAL) {
    return new LedgerGateway({
      ledger: { baseUrl: env.LEDGER_API_URL },
      operatorParty: env.OPERATOR_PARTY,
      userId: env.SANDBOX_USER_ID,
    })
  }
  if (
    env.OIDC_USERNAME === undefined ||
    env.OIDC_PASSWORD === undefined ||
    env.OIDC_TOKEN_URL === undefined ||
    env.OIDC_CLIENT_ID === undefined
  ) {
    return undefined
  }
  return new LedgerGateway({
    ledger: { baseUrl: env.LEDGER_API_URL },
    oidc: {
      tokenUrl: env.OIDC_TOKEN_URL,
      clientId: env.OIDC_CLIENT_ID,
      scope: env.OIDC_SCOPE,
      username: env.OIDC_USERNAME,
      password: env.OIDC_PASSWORD,
    },
    operatorParty: env.OPERATOR_PARTY,
    // Real CBTC only on devnet (OIDC path); the local sandbox above stays mock.
    useRealRegistry: env.USE_REAL_REGISTRY,
    registryUrl: env.REGISTRY_URL,
    registrar: env.CBTC_NETWORK_PARTY,
  })
}

// Parse SESSIONS ("token=party,token=party") into the token->party map the server
// uses to bind each caller to their own party. Empty -> no map -> ledger routes 401.
function buildSessions(): Record<string, string> | undefined {
  if (env.SESSIONS === undefined || env.SESSIONS.trim() === '') return undefined
  const map: Record<string, string> = {}
  for (const pair of env.SESSIONS.split(',')) {
    const [token, party] = pair.split('=').map((s) => s.trim())
    if (token !== undefined && token !== '' && party !== undefined && party !== '') {
      map[token] = party
    }
  }
  return Object.keys(map).length > 0 ? map : undefined
}

const srv = startServer({
  port: env.PORT,
  ledger: { baseUrl: env.LEDGER_API_URL },
  gateway: buildGateway(),
  sessions: buildSessions(),
  operatorParty: env.OPERATOR_PARTY,
  // This process is the intent writer and the status reader. The scheduler runs
  // separately, so the handle is unconditional: with no scheduler running, the status
  // file is simply absent and /engine reports an engine that has not ticked, which is
  // the truth. Reporting 503 instead would confuse "no engine" with "no channel".
  engineControl: makeFileEngineControl(env.ENGINE_CONTROL_DIR, env.TICK_MS),
})

console.error(`overwrite rest-api listening on :${srv.port}`)
