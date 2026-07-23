// Reading REAL CBTC holdings (utility-registry-holding-v0) off the ledger. The real
// holding payload differs from the local mock Overwrite.Allocation:Holding: the
// instrument is nested as `instrument: { source, id, scheme }` (NOT `instrumentId`) and
// there is a nullable `lock`. So it needs its own parse rather than reusing parseHoldings.
// The payload shape and the template-id CONSTANT below (package-name reference form)
// were both confirmed live on devnet 2026-07-21: the shape via scripts/devnet-transfer
// --inspect, and the acsFilter package name by a direct active-contracts query that
// returned the expected holdings.

import type { ActiveContract } from './parse'

// Package-name reference form; resolves to the vetted version on the participant.
export const REAL_CBTC_HOLDING_TID =
  '#utility-registry-holding-v0:Utility.Registry.Holding.V0.Holding:Holding'

export interface HoldingRead {
  cid: string
  owner: string
  instrument: string
  amount: string
}

function asStr(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : ''
}

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
}

// Real CBTC holdings that are UNLOCKED and issued by the registrar. A holding with a
// non-null `lock` is committed elsewhere (e.g. an allocation or a pending transfer) and
// must not be treated as spendable pool. The source check rejects a same-id token from a
// different issuer that is not the real CBTC network. The payload shape (confirmed live
// by scripts/devnet-transfer --inspect) nests the instrument as
// `instrument: { source, id, scheme }`, where `source` is the issuing registrar.
export function parseRealHoldings(cs: ActiveContract[], registrar: string): HoldingRead[] {
  const out: HoldingRead[] = []
  for (const c of cs) {
    const p = c.payload
    if (p.lock !== undefined && p.lock !== null) continue
    const inst = asRecord(p.instrument)
    if (asStr(inst.source) !== registrar) continue
    out.push({
      cid: c.contractId,
      owner: asStr(p.owner),
      instrument: asStr(inst.id),
      amount: asStr(p.amount),
    })
  }
  return out
}
