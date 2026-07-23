// Types for the CBTC registry's token-standard HTTP API (the off-ledger choice
// context + disclosed contracts a two-step token-standard choice demands).
//
// Shapes verified live 2026-07-13 against the CBTC devnet registry and cross-checked
// against DLC-link/canton-lib v0.6.1 (`crates/registry`, `crates/common`). See
// docs/spikes/0.1-allocation-cycle.md "Live cycle CLOSED".

// A contract the submitting party cannot see on its own ACS, handed to the ledger
// alongside the command so the engine can validate a choice that references it (the
// registry's transfer-rule, receiver-credentials, allocation-factory, etc.). The
// JSON Ledger API's `disclosedContracts` entries take exactly these camelCase fields.
export interface DisclosedContract {
  templateId: string
  contractId: string
  createdEventBlob: string
  synchronizerId: string
}

// The result of a registry `choice-contexts/*` fetch: the contracts to disclose,
// plus the opaque context values that go into the exercise's `extraArgs.context`.
export interface ChoiceContext {
  disclosedContracts: DisclosedContract[]
  // Verbatim `choiceContextData.values` from the registry (a Daml `TextMap AnyValue`
  // encoded as JSON). Opaque to us: it is passed through unchanged, never inspected.
  contextValues: unknown
}

// The result of a registry `allocation-instruction/v1/allocation-factory` fetch:
// the AllocationFactory contract to exercise (`factoryId`), plus the context+disclosed
// an `AllocationFactory_Allocate` needs. `context` reuses `ChoiceContext` so
// `toExtraArgs` wraps it unchanged (its `contextValues` is `choiceContextData.values`);
// `disclosed` is the same disclosed list, surfaced directly for the command's
// `disclosedContracts` (the real AllocationFactory + the instrument-config, 2 of them).
export interface FactoryChoiceContext {
  factoryId: string
  context: ChoiceContext
  disclosed: DisclosedContract[]
}

// The `extraArgs` record a token-standard `*_Accept` / `Allocation_*` choice takes.
// `meta.values` is an empty map for these registry-mediated choices.
export interface ChoiceExtraArgs {
  context: { values: unknown }
  meta: { values: Record<string, never> }
}

// Wrap a fetched context into the exact `extraArgs` the exercise choice argument needs.
export function toExtraArgs(ctx: ChoiceContext): ChoiceExtraArgs {
  return { context: { values: ctx.contextValues }, meta: { values: {} } }
}
