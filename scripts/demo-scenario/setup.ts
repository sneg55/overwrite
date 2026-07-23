// Shared setup for the covered-call lifecycle demo: parties -> Vault -> deposit ->
// lock -> write -> pay, plus the oracle observation helper. Both settlement paths
// (see index.ts) start from setupThroughPremium and end at an active CallOption.
// Command bodies come from the backend's real builders (commands.ts).
import {
  createCommand,
  exerciseCommand,
  overwriteTemplateId,
} from '../../backend/src/services/ledger-client/commands'
import {
  allocateParty,
  allocationWindow,
  cidOf,
  emptyExtraArgs,
  relTime,
  submit,
  USER_ID,
} from './ledger'

export const tid = (m: string, t: string): string => overwriteTemplateId(m, t)

// Demo params (not market pricing): spot 60000, strike 10% -> 66000 USDC/CBTC.
export const SPOT = '60000.0'
export const STRIKE = 66000 // spot * (1 + strikePct)
export const NOTIONAL = '1.0'

// A mainnet epoch is a week; this walkthrough compresses the option to seconds so both
// settlement paths run end to end. The collateral is allocated before the option is
// written, so LockCollateral needs this same number to size its settlement window
// (Vault.WriteCall rejects an option that outlives its collateral). One constant, so
// the two can never drift apart.
export const OPTION_LIFETIME_MS = 4000

export interface Ctx {
  operator: string
  oracle: string
  mmBuyer: string
  option: string
  suffix: string
}

// Shared path: parties -> Vault -> deposit -> lock -> write -> pay. Returns the
// active option ready to settle, plus the parties the settlement step needs.
export async function setupThroughPremium(suffix: string): Promise<Ctx> {
  const cbtcIssuer = await allocateParty(`cbtc-issuer-${suffix}`)
  const operator = await allocateParty(`operator-${suffix}`)
  const oracle = await allocateParty(`oracle-${suffix}`)
  const mmBuyer = await allocateParty(`mm-buyer-${suffix}`)
  const alice = await allocateParty(`alice-${suffix}`)
  console.log(`  parties allocated (suffix ${suffix})`)

  const vault0 = cidOf(
    await submit(
      createCommand({
        templateId: tid('Vault', 'Vault'),
        createArguments: {
          operator,
          oracleParty: oracle,
          epochNumber: '1',
          windowState: 'Open',
          strikePct: '0.1',
          premiumSplitPct: '1.0',
          cashInstrument: 'mUSDC',
          maxObservationAge: relTime(3_600_000_000),
          settleBufferSeconds: relTime(3_600_000_000),
          totalPooledCbtc: '0.0',
          minDepositCbtc: '0.001',
        },
        actAs: [operator],
        commandId: `vault-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Vault',
    'Vault',
  )

  // Registry AllocationFactory stand-in (labeled): LockCollateral allocates the pool
  // through the real CIP-56 factory interface. admin = the CBTC issuer (carries issuer
  // authority); user = operator, the demo-visibility observer. On devnet this is the
  // registry's own public factory reached via disclosed contracts.
  const factoryCid = cidOf(
    await submit(
      createCommand({
        templateId: tid('Allocation', 'MockAllocationFactory'),
        createArguments: { admin: cbtcIssuer, user: operator },
        actAs: [cbtcIssuer],
        commandId: `factory-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'MockAllocationFactory',
  )

  const aliceCbtc = cidOf(
    await submit(
      createCommand({
        templateId: tid('Allocation', 'Holding'),
        createArguments: { issuer: cbtcIssuer, owner: alice, instrument: 'CBTC', amount: '1.0' },
        actAs: [cbtcIssuer],
        commandId: `cbtc-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'Holding',
  )

  const dep = await submit(
    exerciseCommand({
      templateId: tid('Vault', 'Vault'),
      contractId: vault0,
      choice: 'Deposit',
      choiceArgument: { depositor: alice, cbtcCid: aliceCbtc, topUpPositionCid: null },
      actAs: [operator, alice],
      commandId: `deposit-${suffix}`,
      userId: USER_ID,
    }),
  )
  // Deposit is consuming: it archives vault0 and returns the next vault cid.
  const vault0a = cidOf(dep, 'Vault', 'Vault')
  const pool = cidOf(dep, 'Allocation', 'Holding')
  console.log(
    `  deposit -> VaultPosition ${cidOf(dep, 'VaultPosition', 'VaultPosition').slice(0, 12)}...`,
  )

  const lock = await submit(
    exerciseCommand({
      templateId: tid('Vault', 'Vault'),
      contractId: vault0a,
      choice: 'LockCollateral',
      choiceArgument: {
        cbtcPoolCid: pool,
        mmBuyer,
        factoryCid,
        allocContext: emptyExtraArgs(),
        ...allocationWindow(OPTION_LIFETIME_MS),
      },
      actAs: [operator],
      commandId: `lock-${suffix}`,
      userId: USER_ID,
    }),
  )
  const vault1 = cidOf(lock, 'Vault', 'Vault')
  const allocation = cidOf(lock, 'Allocation', 'MockAllocation')
  console.log(`  lock -> CIP-56 allocation ${allocation.slice(0, 12)}...`)

  const expiry = new Date(Date.now() + OPTION_LIFETIME_MS).toISOString()
  const option0 = cidOf(
    await submit(
      exerciseCommand({
        templateId: tid('Vault', 'Vault'),
        contractId: vault1,
        choice: 'WriteCall',
        choiceArgument: {
          mmBuyer,
          collateralAllocationCid: allocation,
          spotAtOpen: SPOT,
          premiumUsdc: '100.0',
          notionalCbtc: NOTIONAL,
          expiry,
        },
        actAs: [operator, mmBuyer],
        commandId: `write-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'CallOption',
    'CallOption',
  )

  const buyerPremium = cidOf(
    await submit(
      createCommand({
        templateId: tid('Allocation', 'Holding'),
        createArguments: { issuer: operator, owner: mmBuyer, instrument: 'mUSDC', amount: '100.0' },
        actAs: [operator],
        commandId: `prem-hold-${suffix}`,
        userId: USER_ID,
      }),
    ),
    'Allocation',
    'Holding',
  )
  const pay = await submit(
    exerciseCommand({
      templateId: tid('CallOption', 'CallOption'),
      contractId: option0,
      choice: 'PayPremium',
      choiceArgument: { premiumCid: buyerPremium },
      actAs: [mmBuyer],
      commandId: `pay-${suffix}`,
      userId: USER_ID,
    }),
  )
  const option = cidOf(pay, 'CallOption', 'CallOption')
  console.log(`  write + pay -> active CallOption ${option.slice(0, 12)}... (expiry ${expiry})`)
  return { operator, oracle, mmBuyer, option, suffix }
}

export async function observe(ctx: Ctx, price: string): Promise<string> {
  return cidOf(
    await submit(
      createCommand({
        templateId: tid('PriceObservation', 'PriceObservation'),
        createArguments: {
          oracleParty: ctx.oracle,
          operator: ctx.operator,
          asset: 'CBTC',
          epochNumber: '1',
          price,
          source: 'demo-scenario',
          observedAt: new Date().toISOString(),
          isDemo: true,
        },
        actAs: [ctx.oracle],
        commandId: `obs-${ctx.suffix}`,
        userId: USER_ID,
      }),
    ),
    'PriceObservation',
    'PriceObservation',
  )
}
