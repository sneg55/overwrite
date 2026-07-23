// Split out of client.test.ts to keep each test file focused (and under the file-size
// limit). Covers fetchTransferFactoryChoiceContext, the deposit-move context fetch.
import { describe, expect, test } from 'bun:test'
import { AppError, ErrorIds } from '../../constants/errorIds'
import { fetchTransferFactoryChoiceContext } from './client'

const REGISTRY = 'https://registry.example'
const REGISTRAR = 'cbtc-network::1220ab'

function stubFetch(
  status: number,
  body: unknown,
  capture?: { url?: string; body?: string },
): typeof fetch {
  return ((url: string, init?: RequestInit) => {
    if (capture) {
      capture.url = url
      capture.body = init?.body as string
    }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

async function caughtId(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
    return undefined
  } catch (e) {
    return e instanceof AppError ? e.id : `non-app-error: ${String(e)}`
  }
}

const signal = () => new AbortController().signal

describe('fetchTransferFactoryChoiceContext', () => {
  // Same nested-choiceContext shape as the allocation factory: factoryId at top level,
  // context + disclosed nested under choiceContext.
  const factoryBody = {
    factoryId: '00xferfactory',
    choiceContext: {
      choiceContextData: {
        values: {
          'utility.digitalasset.com/transfer-factory': {
            tag: 'AV_ContractId',
            value: '00xferfactory',
          },
        },
      },
      disclosedContracts: [
        {
          templateId: 'pkg:TransferInstr:TransferFactory',
          contractId: '00xferfactory',
          createdEventBlob: 'eGZlcg==',
          synchronizerId: 'sync::1220',
          debugPackageName: 'splice-token-standard',
        },
      ],
    },
  }

  const choiceArgs = {
    expectedAdmin: REGISTRAR,
    transfer: { sender: 'alice::ns', receiver: 'op::ns', amount: '0.01' },
    inputHoldingCids: ['00holding'],
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  }

  test('POSTs the transfer-factory endpoint with expectedAdmin + choiceArguments and bearer token', async () => {
    const cap: { url?: string; body?: string } = {}
    await fetchTransferFactoryChoiceContext(
      REGISTRY,
      REGISTRAR,
      'tok123',
      choiceArgs,
      signal(),
      stubFetch(200, factoryBody, cap),
    )
    expect(cap.url).toBe(
      `${REGISTRY}/api/token-standard/v0/registrars/${REGISTRAR}/registry/transfer-instruction/v1/transfer-factory`,
    )
    expect(JSON.parse(cap.body ?? '{}')).toEqual({
      expectedAdmin: REGISTRAR,
      choiceArguments: choiceArgs,
    })
  })

  test('parses factoryId and disclosed contract (debug fields stripped)', async () => {
    const fcc = await fetchTransferFactoryChoiceContext(
      REGISTRY,
      REGISTRAR,
      'tok123',
      choiceArgs,
      signal(),
      stubFetch(200, factoryBody),
    )
    expect(fcc.factoryId).toBe('00xferfactory')
    expect(fcc.disclosed).toHaveLength(1)
    expect(fcc.disclosed[0]).toEqual({
      templateId: 'pkg:TransferInstr:TransferFactory',
      contractId: '00xferfactory',
      createdEventBlob: 'eGZlcg==',
      synchronizerId: 'sync::1220',
    })
    expect(fcc.context.contextValues).toEqual(factoryBody.choiceContext.choiceContextData.values)
  })

  test('rejects a non-200 with REG_CHOICE_CONTEXT_FAIL', async () => {
    expect(
      await caughtId(
        fetchTransferFactoryChoiceContext(
          REGISTRY,
          REGISTRAR,
          'tok123',
          choiceArgs,
          signal(),
          stubFetch(500, { error: 'boom' }),
        ),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_FAIL)
  })

  test('rejects a payload missing factoryId with REG_CHOICE_CONTEXT_MALFORMED', async () => {
    expect(
      await caughtId(
        fetchTransferFactoryChoiceContext(
          REGISTRY,
          REGISTRAR,
          'tok123',
          choiceArgs,
          signal(),
          stubFetch(200, { choiceContext: factoryBody.choiceContext }),
        ),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_MALFORMED)
  })
})
