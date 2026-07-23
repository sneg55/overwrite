import { expect, test } from 'bun:test'
import { LedgerGateway } from './gateway'

// depositAmount's guards and whole-holding routing, tested without a ledger: we
// construct a real gateway and override its two network methods (activeContracts,
// deposit). The partial-deposit split path submits to the ledger, so it is proven by
// the devnet/sandbox end-to-end check, not here. No mock.module (its mutation is
// process-wide and would leak into other backend suites).
function stubGateway(holdingAmount: string): {
  gw: LedgerGateway
  deposited: () => { depositor: string; vaultCid: string; cbtcCid: string } | null
} {
  const gw = new LedgerGateway({
    ledger: {} as never,
    operatorParty: 'operator',
    userId: 'participant_admin',
  })
  let captured: { depositor: string; vaultCid: string; cbtcCid: string } | null = null
  // biome-ignore lint/suspicious/noExplicitAny: overriding instance methods for the test.
  ;(gw as any).activeContracts = () =>
    Promise.resolve([{ contractId: 'h-1', payload: { amount: holdingAmount } }])
  // biome-ignore lint/suspicious/noExplicitAny: overriding instance methods for the test.
  ;(gw as any).deposit = (depositor: string, vaultCid: string, cbtcCid: string) => {
    captured = { depositor, vaultCid, cbtcCid }
    return Promise.resolve({ ok: true })
  }
  return { gw, deposited: () => captured }
}

async function rejection(p: Promise<unknown>): Promise<string> {
  try {
    await p
    return ''
  } catch (e) {
    return e instanceof Error ? e.message : String(e)
  }
}

test('depositAmount deposits the whole holding (no split) when the amount is the full balance', async () => {
  const { gw, deposited } = stubGateway('2.0000000000')
  await gw.depositAmount('alice', 'v-1', 'h-1', '2.0')
  expect(deposited()).toEqual({ depositor: 'alice', vaultCid: 'v-1', cbtcCid: 'h-1' })
})

test('depositAmount rejects an amount above the holding balance', async () => {
  const { gw, deposited } = stubGateway('2.0000000000')
  expect(await rejection(gw.depositAmount('alice', 'v-1', 'h-1', '3.0'))).toContain('exceeds')
  expect(deposited()).toBeNull()
})

test('depositAmount rejects a non-positive amount before touching the ledger', async () => {
  const { gw, deposited } = stubGateway('2.0000000000')
  expect(await rejection(gw.depositAmount('alice', 'v-1', 'h-1', '0'))).toContain('positive')
  expect(deposited()).toBeNull()
})

test('depositAmount rejects a holding the caller does not own', async () => {
  const { gw } = stubGateway('2.0000000000')
  expect(await rejection(gw.depositAmount('alice', 'v-1', 'not-mine', '1.0'))).toContain(
    'not found',
  )
})
