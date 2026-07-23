import { describe, expect, test } from 'bun:test'
import { AppError, ErrorIds } from '../../constants/errorIds'
import {
  type AllocationChoice,
  fetchAcceptChoiceContext,
  fetchAllocationChoiceContext,
  fetchAllocationFactoryChoiceContext,
} from './client'

const REGISTRY = 'https://registry.example'
const REGISTRAR = 'cbtc-network::1220ab'
const CID = '00offer'

// The real registry response shape (camelCase), verified live 2026-07-13 against
// the CBTC devnet registry (see docs/spikes/0.1-allocation-cycle.md).
const okBody = {
  choiceContextData: {
    values: {
      'utility.digitalasset.com/transfer-rule': { tag: 'AV_ContractId', value: '00rule' },
    },
  },
  disclosedContracts: [
    {
      templateId: 'pkg:Mod:T',
      contractId: '00rule',
      createdEventBlob: 'YmxvYg==',
      synchronizerId: 'sync::1220',
    },
  ],
}

// Injected fetch: records the URL + body it was called with, returns a canned response.
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

// The AppError id thrown by a rejected call (or a marker if it wasn't an AppError).
async function caughtId(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
    return undefined
  } catch (e) {
    return e instanceof AppError ? e.id : `non-app-error: ${String(e)}`
  }
}

const signal = () => new AbortController().signal

describe('fetchAcceptChoiceContext', () => {
  test('POSTs the transfer-instruction accept choice-context endpoint with meta.values ""', async () => {
    const cap: { url?: string; body?: string } = {}
    await fetchAcceptChoiceContext(REGISTRY, REGISTRAR, CID, signal(), stubFetch(200, okBody, cap))
    expect(cap.url).toBe(
      `${REGISTRY}/api/token-standard/v0/registrars/${REGISTRAR}/registry/transfer-instruction/v1/${CID}/choice-contexts/accept`,
    )
    expect(JSON.parse(cap.body ?? '{}')).toEqual({ meta: { values: '' } })
  })

  test('maps the registry response into disclosed contracts and context values', async () => {
    const ctx = await fetchAcceptChoiceContext(
      REGISTRY,
      REGISTRAR,
      CID,
      signal(),
      stubFetch(200, okBody),
    )
    expect(ctx.disclosedContracts).toHaveLength(1)
    expect(ctx.disclosedContracts[0]).toEqual({
      templateId: 'pkg:Mod:T',
      contractId: '00rule',
      createdEventBlob: 'YmxvYg==',
      synchronizerId: 'sync::1220',
    })
    expect(ctx.contextValues).toEqual(okBody.choiceContextData.values)
  })

  test('rejects a non-200 with REG_CHOICE_CONTEXT_FAIL', async () => {
    expect(
      await caughtId(
        fetchAcceptChoiceContext(
          REGISTRY,
          REGISTRAR,
          CID,
          signal(),
          stubFetch(503, { error: 'down' }),
        ),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_FAIL)
  })

  test('rejects a malformed disclosed contract with REG_CHOICE_CONTEXT_MALFORMED', async () => {
    const bad = {
      choiceContextData: { values: {} },
      disclosedContracts: [{ contractId: '00rule' }],
    }
    expect(
      await caughtId(
        fetchAcceptChoiceContext(REGISTRY, REGISTRAR, CID, signal(), stubFetch(200, bad)),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_MALFORMED)
  })

  test('rejects a payload with no choiceContextData with REG_CHOICE_CONTEXT_MALFORMED', async () => {
    const bad = { disclosedContracts: [] }
    expect(
      await caughtId(
        fetchAcceptChoiceContext(REGISTRY, REGISTRAR, CID, signal(), stubFetch(200, bad)),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_MALFORMED)
  })
})

describe('fetchAllocationChoiceContext', () => {
  test('POSTs the allocations choice-context endpoint for execute-transfer', async () => {
    const cap: { url?: string } = {}
    await fetchAllocationChoiceContext(
      REGISTRY,
      REGISTRAR,
      '00alloc',
      'execute-transfer',
      signal(),
      stubFetch(200, okBody, cap),
    )
    expect(cap.url).toBe(
      `${REGISTRY}/api/token-standard/v0/registrars/${REGISTRAR}/registry/allocations/v1/00alloc/choice-contexts/execute-transfer`,
    )
  })

  test('maps withdraw and cancel to their url path segments', async () => {
    for (const choice of ['withdraw', 'cancel'] as AllocationChoice[]) {
      const cap: { url?: string } = {}
      await fetchAllocationChoiceContext(
        REGISTRY,
        REGISTRAR,
        '00alloc',
        choice,
        signal(),
        stubFetch(200, okBody, cap),
      )
      expect(cap.url).toContain(`/choice-contexts/${choice}`)
    }
  })

  test('strips a trailing slash on the base url', async () => {
    const cap: { url?: string } = {}
    await fetchAllocationChoiceContext(
      `${REGISTRY}/`,
      REGISTRAR,
      '00alloc',
      'execute-transfer',
      signal(),
      stubFetch(200, okBody, cap),
    )
    expect(cap.url?.startsWith(`${REGISTRY}/api/token-standard`)).toBe(true)
  })
})

describe('fetchAllocationFactoryChoiceContext', () => {
  // The discovered live shape (2026-07-14): factoryId at top level, context+disclosed
  // NESTED under choiceContext, and each disclosed entry carries extra `debug*` fields
  // the JSON Ledger API rejects (they must be stripped to the 4 camelCase fields).
  const factoryBody = {
    factoryId: '00factory',
    choiceContext: {
      choiceContextData: {
        values: {
          'splice.lfdecentralizedtrust.org/allocation-factory': {
            tag: 'AV_ContractId',
            value: '00factory',
          },
        },
      },
      disclosedContracts: [
        {
          templateId: 'pkg:AllocInstr:AllocationFactory',
          contractId: '00factory',
          createdEventBlob: 'ZmFjdG9yeQ==',
          synchronizerId: 'sync::1220',
          debugPackageName: 'splice-token-standard',
          debugCreatedAt: '2026-07-14T00:00:00Z',
        },
        {
          templateId: 'pkg:InstrCfg:InstrumentConfiguration',
          contractId: '00instr',
          createdEventBlob: 'aW5zdHI=',
          synchronizerId: 'sync::1220',
          debugPackageName: 'cbtc-instrument',
        },
      ],
    },
  }

  const choiceArgs = {
    expectedAdmin: REGISTRAR,
    allocation: { transferLegId: 'collateral' },
    requestedAt: '2026-07-14T12:00:00Z',
    inputHoldingCids: ['00holding'],
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  }

  test('POSTs the allocation-factory endpoint with expectedAdmin + choiceArguments and bearer token', async () => {
    const cap: { url?: string; body?: string } = {}
    await fetchAllocationFactoryChoiceContext(
      REGISTRY,
      REGISTRAR,
      'tok123',
      choiceArgs,
      signal(),
      stubFetch(200, factoryBody, cap),
    )
    expect(cap.url).toBe(
      `${REGISTRY}/api/token-standard/v0/registrars/${REGISTRAR}/registry/allocation-instruction/v1/allocation-factory`,
    )
    expect(JSON.parse(cap.body ?? '{}')).toEqual({
      expectedAdmin: REGISTRAR,
      choiceArguments: choiceArgs,
    })
  })

  test('parses factoryId, both disclosed contracts (debug fields stripped), and passes context values through', async () => {
    const fcc = await fetchAllocationFactoryChoiceContext(
      REGISTRY,
      REGISTRAR,
      'tok123',
      choiceArgs,
      signal(),
      stubFetch(200, factoryBody),
    )
    expect(fcc.factoryId).toBe('00factory')
    expect(fcc.disclosed).toHaveLength(2)
    expect(fcc.disclosed[0]).toEqual({
      templateId: 'pkg:AllocInstr:AllocationFactory',
      contractId: '00factory',
      createdEventBlob: 'ZmFjdG9yeQ==',
      synchronizerId: 'sync::1220',
    })
    expect(fcc.disclosed[1]?.contractId).toBe('00instr')
    // context reuses ChoiceContext so toExtraArgs can wrap it; values pass through verbatim.
    expect(fcc.context.contextValues).toEqual(factoryBody.choiceContext.choiceContextData.values)
    expect(fcc.context.disclosedContracts).toEqual(fcc.disclosed)
  })

  test('rejects a non-200 with REG_CHOICE_CONTEXT_FAIL', async () => {
    expect(
      await caughtId(
        fetchAllocationFactoryChoiceContext(
          REGISTRY,
          REGISTRAR,
          'tok123',
          choiceArgs,
          signal(),
          stubFetch(400, { error: 'bad request' }),
        ),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_FAIL)
  })

  test('rejects a payload missing factoryId with REG_CHOICE_CONTEXT_MALFORMED', async () => {
    const bad = { choiceContext: factoryBody.choiceContext }
    expect(
      await caughtId(
        fetchAllocationFactoryChoiceContext(
          REGISTRY,
          REGISTRAR,
          'tok123',
          choiceArgs,
          signal(),
          stubFetch(200, bad),
        ),
      ),
    ).toBe(ErrorIds.REG_CHOICE_CONTEXT_MALFORMED)
  })
})
