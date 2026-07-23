// Client over the CBTC registry's token-standard choice-context HTTP API. Every
// two-step registry choice (accept an incoming transfer, settle / withdraw / cancel
// an allocation) needs an off-ledger context fetched here and submitted to the ledger
// as disclosed contracts. `commands.ts` no longer hardcodes `disclosedContracts: []`.
//
// Endpoint shapes verified live 2026-07-13 (docs/spikes/0.1-allocation-cycle.md) and
// against DLC-link/canton-lib v0.6.1 (`crates/registry/src/{accept,allocation}_context.rs`):
//
//   POST {base}/api/token-standard/v0/registrars/{registrar}/registry/
//        transfer-instruction/v1/{cid}/choice-contexts/accept          (accept)
//        allocations/v1/{cid}/choice-contexts/{execute-transfer|withdraw|cancel}
//   body -> { "meta": { "values": "" } }
//   200  -> { "choiceContextData": { "values": <json> },
//            "disclosedContracts": [ { templateId, contractId, createdEventBlob, synchronizerId } ] }
//
// `fetchImpl` is injected so tests never touch the network. Cancellation is threaded
// through as an AbortSignal.

import { AppError, ErrorIds } from '@/constants/errorIds'
import type { ChoiceContext, DisclosedContract, FactoryChoiceContext } from './types'

const DEFAULT_TIMEOUT_MS = 20_000

// Allocation choices whose context lives under a distinct `choice-contexts/*` path.
export type AllocationChoice = 'execute-transfer' | 'withdraw' | 'cancel'

function registrarBase(baseUrl: string, registrar: string): string {
  return `${baseUrl.replace(/\/$/, '')}/api/token-standard/v0/registrars/${registrar}/registry`
}

interface RawDisclosed {
  templateId?: unknown
  contractId?: unknown
  createdEventBlob?: unknown
  synchronizerId?: unknown
}

function toDisclosed(raw: RawDisclosed): DisclosedContract {
  const { templateId, contractId, createdEventBlob, synchronizerId } = raw
  if (
    typeof templateId !== 'string' ||
    typeof contractId !== 'string' ||
    typeof createdEventBlob !== 'string' ||
    typeof synchronizerId !== 'string'
  ) {
    throw new AppError(
      ErrorIds.REG_CHOICE_CONTEXT_MALFORMED,
      'disclosed contract missing string fields',
      {
        raw,
      },
    )
  }
  return { templateId, contractId, createdEventBlob, synchronizerId }
}

// POST a registry choice-context endpoint and normalize the response. All the
// endpoints share this request body and response shape; only the URL differs.
async function postChoiceContext(
  url: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch,
): Promise<ChoiceContext> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ meta: { values: '' } }),
      signal,
    })
  } catch (cause) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry request failed: ${url}`, {
      cause: String(cause),
    })
  }

  if (!response.ok) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry HTTP ${response.status}`, {
      url,
    })
  }

  const body = (await response.json()) as {
    choiceContextData?: { values?: unknown } | null
    disclosedContracts?: unknown
  }
  if (
    typeof body.choiceContextData !== 'object' ||
    body.choiceContextData === null ||
    !Array.isArray(body.disclosedContracts)
  ) {
    throw new AppError(
      ErrorIds.REG_CHOICE_CONTEXT_MALFORMED,
      'registry response missing choiceContextData/disclosedContracts',
      {
        url,
      },
    )
  }

  return {
    contextValues: body.choiceContextData.values ?? {},
    disclosedContracts: body.disclosedContracts.map((d) => toDisclosed(d as RawDisclosed)),
  }
}

function withTimeout(signal: AbortSignal): AbortSignal {
  // Honor the caller's cancellation and add a hard timeout ceiling.
  return AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_TIMEOUT_MS)])
}

// Choice context for accepting an incoming CBTC transfer offer (TransferInstruction).
// Proven live 2026-07-13. `transferInstructionCid` is the pending TransferOffer cid.
export async function fetchAcceptChoiceContext(
  baseUrl: string,
  registrar: string,
  transferInstructionCid: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ChoiceContext> {
  const url = `${registrarBase(baseUrl, registrar)}/transfer-instruction/v1/${transferInstructionCid}/choice-contexts/accept`
  return await postChoiceContext(url, withTimeout(signal), fetchImpl)
}

// Raw shape of the allocation-factory response. The context + disclosed are NESTED
// under `choiceContext` here (unlike the flat `choice-contexts/*` endpoints above).
interface RawFactoryContext {
  factoryId?: unknown
  choiceContext?: {
    choiceContextData?: { values?: unknown } | null
    disclosedContracts?: unknown
  } | null
}

// Choice context for a fresh `AllocationFactory_Allocate` (the collateral lock). Unlike
// the flat choice-context endpoints, this one is authenticated (bearer) and takes the
// full `choiceArguments` in the request body; the 200 carries the AllocationFactory cid
// to exercise plus the 2 disclosed contracts (factory + instrument-config). Verified
// live 2026-07-14 against the CBTC devnet registry. `debug*` fields on each disclosed
// entry are dropped by `toDisclosed`.
export async function fetchAllocationFactoryChoiceContext(
  baseUrl: string,
  registrar: string,
  token: string,
  choiceArguments: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal,
  fetchImpl: typeof fetch = fetch,
): Promise<FactoryChoiceContext> {
  const url = `${registrarBase(baseUrl, registrar)}/allocation-instruction/v1/allocation-factory`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ expectedAdmin: registrar, choiceArguments }),
      signal: withTimeout(signal),
    })
  } catch (cause) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry request failed: ${url}`, {
      cause: String(cause),
    })
  }

  if (!response.ok) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry HTTP ${response.status}`, {
      url,
    })
  }

  const body = (await response.json()) as RawFactoryContext
  const cc = body.choiceContext
  if (
    typeof body.factoryId !== 'string' ||
    typeof cc !== 'object' ||
    cc === null ||
    typeof cc.choiceContextData !== 'object' ||
    cc.choiceContextData === null ||
    !Array.isArray(cc.disclosedContracts)
  ) {
    throw new AppError(
      ErrorIds.REG_CHOICE_CONTEXT_MALFORMED,
      'factory response missing factoryId / choiceContext',
      { url },
    )
  }

  const disclosed = cc.disclosedContracts.map((d) => toDisclosed(d as RawDisclosed))
  return {
    factoryId: body.factoryId,
    context: { contextValues: cc.choiceContextData.values ?? {}, disclosedContracts: disclosed },
    disclosed,
  }
}

// Choice context for creating a transfer via the registry TransferFactory (the deposit
// move: depositor to operator). Mirrors fetchAllocationFactoryChoiceContext: authenticated,
// takes the full choiceArguments, returns the factory cid to exercise plus the disclosed
// contracts. Endpoint path and body shape CONFIRMED live by the Phase 0 spike
// (scripts/devnet-transfer, 2026-07-21): this registry serves one combined factory
// (Utility.Registry.App.V0.Service.AllocationFactory) that also implements the
// TransferFactory interface, so this endpoint returns that factory and
// TransferFactory_Transfer on it succeeds.
export async function fetchTransferFactoryChoiceContext(
  baseUrl: string,
  registrar: string,
  token: string,
  choiceArguments: Record<string, unknown>,
  signal: AbortSignal = new AbortController().signal,
  fetchImpl: typeof fetch = fetch,
): Promise<FactoryChoiceContext> {
  const url = `${registrarBase(baseUrl, registrar)}/transfer-instruction/v1/transfer-factory`
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token.length > 0 ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ expectedAdmin: registrar, choiceArguments }),
      signal: withTimeout(signal),
    })
  } catch (cause) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry request failed: ${url}`, {
      cause: String(cause),
    })
  }

  if (!response.ok) {
    throw new AppError(ErrorIds.REG_CHOICE_CONTEXT_FAIL, `registry HTTP ${response.status}`, {
      url,
    })
  }

  const body = (await response.json()) as RawFactoryContext
  const cc = body.choiceContext
  if (
    typeof body.factoryId !== 'string' ||
    typeof cc !== 'object' ||
    cc === null ||
    typeof cc.choiceContextData !== 'object' ||
    cc.choiceContextData === null ||
    !Array.isArray(cc.disclosedContracts)
  ) {
    throw new AppError(
      ErrorIds.REG_CHOICE_CONTEXT_MALFORMED,
      'transfer factory response missing factoryId / choiceContext',
      { url },
    )
  }

  const disclosed = cc.disclosedContracts.map((d) => toDisclosed(d as RawDisclosed))
  return {
    factoryId: body.factoryId,
    context: { contextValues: cc.choiceContextData.values ?? {}, disclosedContracts: disclosed },
    disclosed,
  }
}

// Choice context for settling / withdrawing / cancelling an existing allocation.
// SettleITM exercises `execute-transfer`; rollover/withdraw exercise `withdraw`/`cancel`.
export async function fetchAllocationChoiceContext(
  baseUrl: string,
  registrar: string,
  allocationCid: string,
  choice: AllocationChoice,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<ChoiceContext> {
  const url = `${registrarBase(baseUrl, registrar)}/allocations/v1/${allocationCid}/choice-contexts/${choice}`
  return await postChoiceContext(url, withTimeout(signal), fetchImpl)
}
