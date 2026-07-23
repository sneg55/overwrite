import { describe, expect, test } from 'bun:test'
import { cmdId, LedgerSession } from './session'

// Stub the module-level fetch the client uses. Each ledger endpoint returns a
// canned body so we assert the session shapes requests and parses responses right.
// An optional `onRequest` callback observes each call's url/init (e.g. to capture
// the Authorization header sent on a given request) without changing the response.
function stubFetch(
  routes: Record<string, unknown>,
  onRequest?: (url: string, init?: RequestInit) => void,
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    const u = url instanceof Request ? url.url : String(url)
    onRequest?.(u, init)
    const key = Object.keys(routes).find((k) => u.endsWith(k))
    if (key === undefined) return new Response('not found', { status: 404 })
    return new Response(JSON.stringify(routes[key]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

describe('LedgerSession (local no-auth)', () => {
  const session = new LedgerSession({
    ledger: { baseUrl: 'http://x' },
    userId: 'participant_admin',
  })

  test('query returns parsed active contracts scoped to a party', async () => {
    const original = globalThis.fetch
    globalThis.fetch = stubFetch({
      '/v2/state/ledger-end': { offset: 42 },
      '/v2/state/active-contracts': [
        {
          contractEntry: {
            JsActiveContract: {
              createdEvent: { contractId: '00pos', createArgument: { depositor: 'alice' } },
            },
          },
        },
      ],
    })
    try {
      const acs = await session.query('operator', 'VaultPosition', 'VaultPosition')
      expect(acs).toHaveLength(1)
      expect(acs[0]?.contractId).toBe('00pos')
      expect(acs[0]?.payload.depositor).toBe('alice')
    } finally {
      globalThis.fetch = original
    }
  })

  test('exercise submits and parses the created contracts', async () => {
    const original = globalThis.fetch
    globalThis.fetch = stubFetch({
      '/v2/commands/submit-and-wait-for-transaction': {
        transaction: {
          events: [
            {
              CreatedEvent: {
                templateId: 'p:Overwrite.CallOption:CallOption',
                contractId: '00opt',
                createArgument: { state: 'Written' },
              },
            },
          ],
        },
      },
    })
    try {
      const tx = await session.exercise({
        module: 'Vault',
        template: 'Vault',
        contractId: '00vault',
        choice: 'WriteCall',
        choiceArgument: {},
        actAs: ['operator'],
        commandId: cmdId('write'),
      })
      expect(tx.created[0]?.contractId).toBe('00opt')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('LedgerSession (oidc)', () => {
  test('query sends the cached bearer token as the ledger request Authorization header', async () => {
    const original = globalThis.fetch
    let ledgerAuth: string | undefined
    globalThis.fetch = stubFetch(
      {
        '/realms/noders-appsfactory/protocol/openid-connect/token': {
          access_token: 'tok-123',
          expires_in: 3600,
        },
        '/v2/state/ledger-end': { offset: 42 },
        '/v2/state/active-contracts': [
          {
            contractEntry: {
              JsActiveContract: {
                createdEvent: { contractId: '00pos', createArgument: { depositor: 'alice' } },
              },
            },
          },
        ],
      },
      (url, init) => {
        if (url.endsWith('/v2/state/ledger-end') || url.endsWith('/v2/state/active-contracts')) {
          ledgerAuth = (init?.headers as Record<string, string> | undefined)?.authorization
        }
      },
    )
    try {
      const session = new LedgerSession({
        ledger: { baseUrl: 'http://x' },
        oidc: {
          tokenUrl: 'http://kc/realms/noders-appsfactory/protocol/openid-connect/token',
          clientId: 'web-app-ui-hackcanton-01-devnet',
          scope: 'openid daml_ledger_api offline_access',
          username: 'alice',
          password: 'secret',
        },
      })
      const acs = await session.query('operator', 'VaultPosition', 'VaultPosition')
      expect(acs).toHaveLength(1)
      expect(ledgerAuth).toBe('Bearer tok-123')
    } finally {
      globalThis.fetch = original
    }
  })
})

describe('cmdId', () => {
  test('is unique per call', () => {
    expect(cmdId('x')).not.toBe(cmdId('x'))
  })
})
