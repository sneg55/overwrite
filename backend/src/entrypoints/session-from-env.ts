// Shared entrypoint wiring: build one LedgerSession from the env boundary. Local
// no-auth mode (sandbox) uses an empty bearer + user-id in command bodies; devnet
// uses the Keycloak password grant. Entrypoints are allowed to read env.
import { AppError, ErrorIds } from '@/constants/errorIds'
import { LedgerSession } from '@/services/ledger-client/session'
import { env } from '@/utils/env'

export function sessionFromEnv(): LedgerSession {
  const ledger = { baseUrl: env.LEDGER_API_URL }
  if (env.LEDGER_LOCAL) {
    return new LedgerSession({ ledger, userId: env.SANDBOX_USER_ID })
  }
  if (
    env.OIDC_TOKEN_URL !== undefined &&
    env.OIDC_CLIENT_ID !== undefined &&
    env.OIDC_USERNAME !== undefined &&
    env.OIDC_PASSWORD !== undefined
  ) {
    return new LedgerSession({
      ledger,
      oidc: {
        tokenUrl: env.OIDC_TOKEN_URL,
        clientId: env.OIDC_CLIENT_ID,
        scope: env.OIDC_SCOPE,
        username: env.OIDC_USERNAME,
        password: env.OIDC_PASSWORD,
      },
    })
  }
  throw new AppError(ErrorIds.CFG_ENV_MISSING, 'no ledger auth: set LEDGER_LOCAL=true or OIDC_*')
}
