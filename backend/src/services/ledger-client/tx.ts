// Parse a JSON Ledger API v2 `submit-and-wait-for-transaction` response into a flat
// list of created contracts (with payloads) plus the exercise result. The response
// is { transaction: { events: [ { CreatedEvent: {...} } | { ExercisedEvent: {...} } ] } }.
// Created templateIds arrive fully qualified (`<pkg>:Overwrite.<Module>:<Template>`),
// so selection matches the `Overwrite.<module>:<template>` suffix. Anything that does
// not match a known shape is skipped, so a partial/interleaved event never throws here.

import { AppError, ErrorIds } from '@/constants/errorIds'

export interface Created {
  templateId: string
  contractId: string
  payload: Record<string, unknown>
}

export interface ParsedTx {
  created: Created[]
  exerciseResult: unknown
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : undefined
}

export function parseTx(raw: unknown): ParsedTx {
  const tx = asRecord(asRecord(raw)?.transaction)
  const arr = Array.isArray(tx?.events) ? (tx.events as unknown[]) : []
  const created: Created[] = []
  let exerciseResult: unknown
  for (const ev of arr) {
    const c = asRecord(asRecord(ev)?.CreatedEvent)
    if (c !== undefined && typeof c.contractId === 'string' && typeof c.templateId === 'string') {
      created.push({
        templateId: c.templateId,
        contractId: c.contractId,
        payload: asRecord(c.createArgument) ?? {},
      })
    }
    const x = asRecord(asRecord(ev)?.ExercisedEvent)
    if (x !== undefined && x.exerciseResult !== undefined) exerciseResult = x.exerciseResult
  }
  return { created, exerciseResult }
}

export function createdOf(tx: ParsedTx, module: string, template: string): Created[] {
  const suffix = `Overwrite.${module}:${template}`
  return tx.created.filter((c) => c.templateId.endsWith(suffix))
}

export function firstCreated(tx: ParsedTx, module: string, template: string): Created {
  const hit = createdOf(tx, module, template)[0]
  if (hit === undefined) {
    throw new AppError(
      ErrorIds.LGR_CONTRACT_NOT_FOUND,
      `${ErrorIds.LGR_CONTRACT_NOT_FOUND}: no created Overwrite.${module}:${template}`,
      { seen: tx.created.map((c) => c.templateId) },
    )
  }
  return hit
}
