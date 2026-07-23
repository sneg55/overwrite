// One VaultPosition per depositor per epoch, upheld by TOPPING UP the existing one.
//
// `Vault.RecordEpoch` asserts `unique depositors` over the positions it records, but
// `Vault.Deposit` used to create a new position every time. A depositor who deposited
// twice in one epoch therefore left an epoch the ledger would never record: the
// scheduler failed on every tick and the vault stopped advancing. Observed live,
// wedged at epoch 2.
//
// overwrite-vault 1.2.0 gives Deposit and RecordDeposit a `topUpPositionCid` argument
// that folds the deposit into the depositor's existing position for the epoch. The
// gateway's job is to find that position and name it; passing null is the original
// create-a-new-position behaviour, and is what a first-time depositor gets.
//
// This replaced an interim API-layer guard that refused the second deposit outright.
// The guard was safe but unusable: positions roll forward, so every existing depositor
// holds a position in every epoch and none of them could ever deposit again.

import { expect, test } from 'bun:test'
import { LedgerGateway } from './gateway'

interface StubOpts {
  /** Epochs the depositor already holds a position in. */
  existingEpochs?: number[]
  /** The vault's current epoch. */
  vaultEpoch?: number
}

function stubGateway(opts: StubOpts = {}): {
  gw: LedgerGateway
  toppedUp: () => string | null | undefined
} {
  const { existingEpochs = [], vaultEpoch = 5 } = opts
  const gw = new LedgerGateway({
    ledger: {} as never,
    operatorParty: 'operator',
    userId: 'participant_admin',
  })
  let captured: string | null | undefined
  // biome-ignore lint/suspicious/noExplicitAny: overriding instance methods for the test.
  ;(gw as any).activeContracts = (_party: string, _module: string, template: string) => {
    if (template === 'Vault') {
      return Promise.resolve([{ contractId: 'v-1', payload: { epochNumber: String(vaultEpoch) } }])
    }
    if (template === 'VaultPosition') {
      return Promise.resolve(
        existingEpochs.map((e, i) => ({
          contractId: `pos-epoch-${e}-${i}`,
          payload: { depositor: 'alice', epochNumber: String(e), principalCbtc: '1.0' },
        })),
      )
    }
    return Promise.resolve([{ contractId: 'h-1', payload: { amount: '2.0000000000' } }])
  }
  // biome-ignore lint/suspicious/noExplicitAny: overriding instance methods for the test.
  ;(gw as any).submitDeposit = (
    _depositor: string,
    _vaultCid: string,
    _cbtcCid: string,
    topUpPositionCid: string | null,
  ) => {
    captured = topUpPositionCid
    return Promise.resolve({ ok: true })
  }
  return { gw, toppedUp: () => captured }
}

test('a deposit names the position to top up when the depositor already has one', async () => {
  const { gw, toppedUp } = stubGateway({ existingEpochs: [5], vaultEpoch: 5 })
  await gw.deposit('alice', 'v-1', 'h-1')
  expect(toppedUp()).toBe('pos-epoch-5-0')
})

test('a first-time depositor tops up nothing', async () => {
  const { gw, toppedUp } = stubGateway({ existingEpochs: [], vaultEpoch: 5 })
  await gw.deposit('alice', 'v-1', 'h-1')
  expect(toppedUp()).toBeNull()
})

test('a position from an earlier epoch is not a top-up target', async () => {
  // Daml refuses a cross-epoch top-up outright, so naming one would turn an ordinary
  // deposit into a rejected command.
  const { gw, toppedUp } = stubGateway({ existingEpochs: [4], vaultEpoch: 5 })
  await gw.deposit('alice', 'v-1', 'h-1')
  expect(toppedUp()).toBeNull()
})

test('the current epoch is picked out of a mixed position history', async () => {
  const { gw, toppedUp } = stubGateway({ existingEpochs: [3, 4, 5], vaultEpoch: 5 })
  await gw.deposit('alice', 'v-1', 'h-1')
  expect(toppedUp()).toBe('pos-epoch-5-2')
})

test('depositAmount resolves the top-up target too', async () => {
  // The whole-holding branch of depositAmount routes through deposit(), so this proves
  // the amount-aware entry point carries the target rather than dropping it.
  const { gw, toppedUp } = stubGateway({ existingEpochs: [5], vaultEpoch: 5 })
  await gw.depositAmount('alice', 'v-1', 'h-1', '2.0')
  expect(toppedUp()).toBe('pos-epoch-5-0')
})
