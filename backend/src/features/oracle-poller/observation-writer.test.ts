import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import type { OracleConfig } from './observation-writer'
import { writeObservation } from './observation-writer'

const cfg: OracleConfig = { operator: 'operator', oracle: 'oracle', pollMs: 3_000 }

describe('writeObservation', () => {
  test('creates a PriceObservation for the live epoch, signed by the oracle', async () => {
    const creates: Array<{ createArguments: Record<string, unknown>; actAs: string[] }> = []
    const session = {
      query: (_p: string, m: string) =>
        m === 'Vault'
          ? [{ contractId: '00v', payload: { epochNumber: '2', windowState: 'Locked' } }]
          : [],
      create: (a: { createArguments: Record<string, unknown>; actAs: string[] }) => {
        creates.push({ createArguments: a.createArguments, actAs: a.actAs })
        return { created: [], exerciseResult: null }
      },
    }
    const ok = await writeObservation(session as never, cfg, '60000.0', false, 1_720_000_000_000)
    expect(ok).toBe(true)
    expect(creates[0]?.actAs).toEqual(['oracle'])
    expect(creates[0]?.createArguments.epochNumber).toBe('2')
    expect(creates[0]?.createArguments.oracleParty).toBe('oracle')
    expect(creates[0]?.createArguments.isDemo).toBe(false)
    expect(creates[0]?.createArguments.price).toBe('60000.0')
  })

  test('returns false (writes nothing) when no vault exists yet', async () => {
    let called = false
    const session = {
      query: () => [],
      create: () => {
        called = true
        return { created: [], exerciseResult: null }
      },
    }
    expect(await writeObservation(session as never, cfg, '60000.0', false)).toBe(false)
    expect(called).toBe(false)
  })
})
