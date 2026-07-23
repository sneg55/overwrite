// Low-level JSON Ledger API v2 helpers for the demo-scenario driver. The command
// *bodies* come from the backend's real builders (commands.ts); this module only
// does party allocation, the POST wrapper, and created-contract extraction.
const LEDGER = process.env.LEDGER_API_URL ?? 'http://localhost:7575'
export const USER_ID = process.env.SANDBOX_USER_ID ?? 'participant_admin'
const TIMEOUT = 20_000

export interface Created {
  templateId: string
  contractId: string
}
export interface SubmitResult {
  created: Created[]
  exerciseResult: unknown
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${LEDGER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) throw new Error(`POST ${path} -> HTTP ${res.status}: ${JSON.stringify(json)}`)
  return json
}

export async function allocateParty(hint: string): Promise<string> {
  const body = await post('/v2/parties', { partyIdHint: hint, identityProviderId: '' })
  const details = body.partyDetails as { party: string } | undefined
  if (details?.party === undefined) {
    throw new Error(`allocateParty(${hint}): ${JSON.stringify(body)}`)
  }
  return details.party
}

export async function submit(jsCommandsBody: unknown): Promise<SubmitResult> {
  const body = await post('/v2/commands/submit-and-wait-for-transaction', jsCommandsBody)
  const tx = body.transaction as { events?: Record<string, unknown>[] } | undefined
  const created: Created[] = []
  let exerciseResult: unknown
  for (const ev of tx?.events ?? []) {
    const c = ev.CreatedEvent as Created | undefined
    if (c?.contractId !== undefined) {
      created.push({ templateId: c.templateId, contractId: c.contractId })
    }
    const x = ev.ExercisedEvent as { exerciseResult?: unknown } | undefined
    if (x?.exerciseResult !== undefined) exerciseResult = x.exerciseResult
  }
  return { created, exerciseResult }
}

/** All created contracts whose templateId ends with `Overwrite.<module>:<template>`. */
export function createdAll(r: SubmitResult, module: string, template: string): string[] {
  const suffix = `Overwrite.${module}:${template}`
  return r.created.filter((c) => c.templateId.endsWith(suffix)).map((c) => c.contractId)
}

/** First created contract of that template, or throw with a useful message. */
export function cidOf(r: SubmitResult, module: string, template: string): string {
  const hit = createdAll(r, module, template)[0]
  if (hit === undefined) {
    const seen = JSON.stringify(r.created.map((c) => c.templateId))
    throw new Error(`no created Overwrite.${module}:${template} in ${seen}`)
  }
  return hit
}

export const relTime = (micros: number): Record<string, string> => ({
  microseconds: String(micros),
})
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
export const ledgerUrl = (): string => LEDGER

/** The empty registry choice context. The local MockAllocation ignores it, and the
 *  demo cash leg is mock USDC, so both legs pass this. The real registry context is
 *  fetched per-leg by the backend's epoch-scheduler, not by these scripts. */
export const emptyExtraArgs = (): Record<string, unknown> => ({
  context: { values: {} },
  meta: { values: {} },
})

/** Matches the settleBufferSeconds every demo vault in scripts/ is created with. */
const SETTLE_BUFFER_MS = 3_600_000
const ALLOCATE_WINDOW_MS = 3_600_000

/**
 * The settlement window that LockCollateral (and Holding.Allocate) take as choice
 * arguments. `optionLifetimeMs` is how far past now the option this collateral backs
 * will expire; pass 0 for a leg that backs no option, such as the ITM cash leg.
 *
 * Two separate Daml guards constrain this, and both bite:
 *
 *   assertValidAllocationWindow  requestedAt <= now, allocateBefore > now, and
 *                               settleBefore >= allocateBefore + settleBufferSeconds.
 *   Vault.WriteCall             expiry <= settleBefore. The collateral has to stay
 *                               settleable for the whole life of the option, or its
 *                               window closes first, the collateral becomes
 *                               withdrawable while the call is still live, and the
 *                               buyer holds an option that cannot be delivered
 *                               against after paying a premium it cannot recover.
 *
 * So settleBefore folds in the option lifetime rather than being a fixed offset: the
 * seed writes a 7-day option, and a flat few-hours window silently fails WriteCall
 * with "option outlives collateral settlement window". This mirrors the backend's
 * lockCollateral (handlers.ts), which derives the same bound from the epoch length.
 */
export const allocationWindow = (
  optionLifetimeMs: number,
  nowMs: number = Date.now(),
): Record<string, string> => {
  const allocateBeforeMs = nowMs + ALLOCATE_WINDOW_MS
  return {
    requestedAt: new Date(nowMs).toISOString(),
    allocateBefore: new Date(allocateBeforeMs).toISOString(),
    settleBefore: new Date(allocateBeforeMs + optionLifetimeMs + SETTLE_BUFFER_MS).toISOString(),
  }
}
