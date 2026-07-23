// Parse a JSON Ledger API v2 /v2/state/active-contracts response into a flat list
// of { contractId, payload }. The response is an array of entries shaped
//   { contractEntry: { JsActiveContract: { createdEvent: { contractId, createArgument } } } }
// Anything that does not match that shape is skipped (the ledger may interleave
// incomplete/other entry kinds); callers get only fully-formed active contracts.

export interface ActiveContract {
  contractId: string
  payload: Record<string, unknown>
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
}

export function parseActiveContracts(raw: unknown): ActiveContract[] {
  if (!Array.isArray(raw)) return []
  const out: ActiveContract[] = []
  for (const entry of raw) {
    const created = asRecord(
      asRecord(asRecord(asRecord(entry)?.contractEntry)?.JsActiveContract)?.createdEvent,
    )
    const contractId = created?.contractId
    if (typeof contractId !== 'string') continue
    out.push({ contractId, payload: asRecord(created?.createArgument) ?? {} })
  }
  return out
}
