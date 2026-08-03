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

  // The oracle used to create on every poll and never archive what it superseded, so a
  // 3s poll minted 20 contracts a minute. On the hosted demo that crossed the JSON API's
  // active-contracts ceiling and every scheduler read started failing, which froze the
  // vault behind a container that still reported healthy. The template has carried a
  // consuming Revise choice for exactly this the whole time.
  //
  // EARLIER and LATER straddle NOW so the monotonic guard is exercised on purpose. The
  // first draft of these fixtures dated an observation after the `now` passed in, and the
  // revise test failed against correct code.
  const NOW = 1_720_000_000_000
  const EARLIER = new Date(NOW - 60_000).toISOString()
  const LATER = new Date(NOW + 60_000).toISOString()

  const obs = (cid: string, epoch: string, isDemo: boolean, at: string): ActiveContract =>
    ({
      contractId: cid,
      payload: { asset: 'CBTC', epochNumber: epoch, isDemo, observedAt: at },
    }) as unknown as ActiveContract

  function sessionWith(observations: ActiveContract[]) {
    const creates: Record<string, unknown>[] = []
    const exercises: Array<{ contractId: string; choice: string; arg: Record<string, unknown> }> =
      []
    const session = {
      query: (_p: string, m: string) =>
        m === 'Vault'
          ? [{ contractId: '00v', payload: { epochNumber: '2', windowState: 'Locked' } }]
          : observations,
      create: (a: { createArguments: Record<string, unknown> }) => {
        creates.push(a.createArguments)
        return { created: [], exerciseResult: null }
      },
      exercise: (a: {
        contractId: string
        choice: string
        choiceArgument: Record<string, unknown>
      }) => {
        exercises.push({ contractId: a.contractId, choice: a.choice, arg: a.choiceArgument })
        return { created: [], exerciseResult: null }
      },
    }
    return { session, creates, exercises }
  }

  test('revises this epoch existing observation instead of creating another', async () => {
    const { session, creates, exercises } = sessionWith([obs('00a', '2', false, EARLIER)])
    const ok = await writeObservation(session as never, cfg, '61000.0', false, NOW)
    expect(ok).toBe(true)
    expect(creates.length).toBe(0)
    expect(exercises.length).toBe(1)
    expect(exercises[0]?.contractId).toBe('00a')
    expect(exercises[0]?.choice).toBe('Revise')
    expect(exercises[0]?.arg.newPrice).toBe('61000.0')
  })

  test('creates rather than revises when the epoch has no observation yet', async () => {
    // A previous epoch's observation is left alone: it is that epoch's settled record.
    const { session, creates, exercises } = sessionWith([obs('00old', '1', false, EARLIER)])
    await writeObservation(session as never, cfg, '61000.0', false, NOW)
    expect(exercises.length).toBe(0)
    expect(creates.length).toBe(1)
    expect(creates[0]?.epochNumber).toBe('2')
  })

  // Revise carries price and time only, so it cannot move an observation between the
  // labeled demo feed and the live one. Reusing a contract across that boundary would
  // leave `source`/`isDemo` describing a feed the price did not come from, which is the
  // one thing this project will not let a number do.
  test('creates rather than revises when the feed label would change', async () => {
    const { session, creates, exercises } = sessionWith([obs('00a', '2', false, EARLIER)])
    await writeObservation(session as never, cfg, '61000.0', true, NOW)
    expect(exercises.length).toBe(0)
    expect(creates.length).toBe(1)
    expect(creates[0]?.isDemo).toBe(true)
  })

  test('never revises backwards, which the choice would reject on-ledger anyway', async () => {
    const { session, creates, exercises } = sessionWith([obs('00a', '2', false, LATER)])
    await writeObservation(session as never, cfg, '61000.0', false, NOW)
    expect(exercises.length).toBe(0)
    expect(creates.length).toBe(0)
  })
})
