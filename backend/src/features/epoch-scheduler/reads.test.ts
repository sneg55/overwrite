import { describe, expect, test } from 'bun:test'
import type { ActiveContract } from '@/services/ledger-client/parse'
import { REAL_CBTC_HOLDING_TID } from '@/services/ledger-client/real-holdings'
import type { LedgerSession } from '@/services/ledger-client/session'
import type { SchedulerConfig } from './config'
import { readTick } from './reads'

const cfg: SchedulerConfig = {
  operator: 'operator',
  oracle: 'oracle',
  mmBuyer: 'mm',
  cashInstrument: 'mUSDC',
  epochLengthMs: 20_000,
  depositWindowMs: 0,
  tickMs: 2_000,
  premiumBps: 100,
  allocateWindowMs: 86_400_000,
  settleBufferMs: 3_600_000,
  useRealRegistry: false,
  registryUrl: 'https://registry.test',
  registrar: 'registrar',
}

// A LedgerSession stub returning canned ACS per template. `byRawTemplate` feeds
// queryRawAt (foreign package template ids), used by the real-registry pool read.
function stubSession(
  byTemplate: Record<string, ActiveContract[]>,
  byRawTemplate: Record<string, ActiveContract[]> = {},
): LedgerSession {
  return {
    // readTick pins every read in a tick to one offset, so it resolves the ledger end
    // once and calls queryAt rather than query. The stub ignores the offset.
    ledgerEnd: () => Promise.resolve(1),
    queryAt: (_offset: number, _party: string, module: string, template: string) =>
      byTemplate[`${module}:${template}`] ?? [],
    queryRawAt: (_offset: number, _party: string, templateId: string) =>
      byRawTemplate[templateId] ?? [],
  } as unknown as LedgerSession
}

describe('readTick', () => {
  test('returns null when no vault exists', async () => {
    const r = await readTick(stubSession({}), cfg, 1_000)
    expect(r).toBeNull()
  })

  test('targets the live vault epoch when there is no leftover', async () => {
    const r = await readTick(
      stubSession({
        'Vault:Vault': [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Open' } }],
        'VaultPosition:VaultPosition': [
          {
            contractId: '00p',
            payload: {
              depositor: 'alice',
              principalCbtc: '1.0',
              epochNumber: '1',
              withdrawQueued: false,
            },
          },
        ],
      }),
      cfg,
      5_000,
    )
    expect(r?.workingEpoch).toBe(1)
    expect(r?.isLeftover).toBe(false)
    expect(r?.positions).toHaveLength(1)
  })

  test('targets a leftover epoch and carries receipt, settlement, and report fields', async () => {
    const r = await readTick(
      stubSession({
        'Vault:Vault': [{ contractId: '00v', payload: { epochNumber: '2', windowState: 'Open' } }],
        'VaultPosition:VaultPosition': [
          {
            contractId: '00p',
            payload: {
              depositor: 'alice',
              principalCbtc: '1.0',
              epochNumber: '1',
              withdrawQueued: false,
            },
          },
        ],
        'PremiumReceipt:PremiumReceipt': [
          {
            contractId: '00rcpt',
            payload: { depositor: 'alice', epochNumber: '1', premiumPaidUsdc: '30.0' },
          },
        ],
        'EpochSettlement:EpochSettlement': [
          {
            contractId: '00settlement',
            payload: { epochNumber: '1', settlementPath: 'OTM', collateralReturned: true },
          },
        ],
        'EpochReport:EpochReport': [
          {
            contractId: '00r',
            payload: { epochNumber: '1', settlementPath: 'OTM', collateralReturned: true },
          },
        ],
      }),
      cfg,
      5_000,
    )
    expect(r?.isLeftover).toBe(true)
    expect(r?.workingEpoch).toBe(1)
    expect(r?.reportPresent).toBe(true)
    expect(r?.receiptCids).toEqual(['00rcpt'])
    expect(r?.settlementCid).toBe('00settlement')
    expect(r?.settlementPath).toBe('OTM')
    expect(r?.settlementCollateralReturned).toBe(true)
    expect(r?.reportSettlementPath).toBe('OTM')
    expect(r?.reportCollateralReturned).toBe(true)
  })

  // MockAllocation (the CIP-56 allocation interface's local stand-in) has no `owner`
  // field: the locked collateral's owner-equivalent is `sender`. Guards against
  // reads.ts silently reusing parseHoldings (which reads `owner`) and yielding an
  // empty allocationCid/cashAllocCid.
  test('reads cbtcAlloc/cashAlloc off MockAllocation.sender, not .owner', async () => {
    const r = await readTick(
      stubSession({
        'Vault:Vault': [
          { contractId: '00v', payload: { epochNumber: '1', windowState: 'Locked' } },
        ],
        'Allocation:MockAllocation': [
          {
            contractId: '00alloc',
            payload: { sender: 'operator', instrument: 'CBTC', amount: '3.0' },
          },
          {
            contractId: '00cash',
            payload: { sender: 'mm', instrument: 'mUSDC', amount: '198000.0' },
          },
        ],
      }),
      cfg,
      5_000,
    )
    expect(r?.allocationPresent).toBe(true)
    expect(r?.allocationCid).toBe('00alloc')
    expect(r?.allocationAmount).toBe('3.0')
    expect(r?.cashAllocCid).toBe('00cash')
  })

  // Real mode must source the CBTC pool from the registry holding template, not the
  // local mock. The mock Allocation:Holding here carries a decoy CBTC holding that must
  // be ignored; the pool must come from queryRawAt(REAL_CBTC_HOLDING_TID).
  test('reads the operator CBTC pool from the real registry template in real mode', async () => {
    const realCfg: SchedulerConfig = { ...cfg, useRealRegistry: true, registrar: 'registrar' }
    const r = await readTick(
      stubSession(
        {
          'Vault:Vault': [
            { contractId: '00v', payload: { epochNumber: '1', windowState: 'Open' } },
          ],
          'Allocation:Holding': [
            {
              contractId: '00mock',
              payload: { owner: 'operator', instrument: 'CBTC', amount: '99.0' },
            },
          ],
        },
        {
          [REAL_CBTC_HOLDING_TID]: [
            {
              contractId: '00real',
              payload: {
                owner: 'operator',
                amount: '0.5',
                lock: null,
                instrument: { source: 'registrar', id: 'CBTC' },
              },
            },
          ],
        },
      ),
      realCfg,
      5_000,
    )
    expect(r?.poolHoldingCid).toBe('00real')
    expect(r?.poolAmount).toBe('0.5')
  })

  test('surfaces only the largest operator cash holding as the premium source', async () => {
    const r = await readTick(
      stubSession({
        'Vault:Vault': [
          { contractId: '00v', payload: { epochNumber: '1', windowState: 'Locked' } },
        ],
        'Allocation:Holding': [
          {
            contractId: '00small',
            payload: { owner: 'operator', instrument: 'mUSDC', amount: '100.0' },
          },
          {
            contractId: '00large',
            payload: { owner: 'operator', instrument: 'mUSDC', amount: '200.0' },
          },
          {
            contractId: '00other-owner',
            payload: { owner: 'alice', instrument: 'mUSDC', amount: '50.0' },
          },
          {
            contractId: '00other-instrument',
            payload: { owner: 'operator', instrument: 'CBTC', amount: '3.0' },
          },
        ],
      }),
      cfg,
      5_000,
    )

    expect(r?.premiumHoldingCid).toBe('00large')
    expect(r?.premiumAmount).toBe('200.0')
    expect(r).not.toHaveProperty('premiumHoldings')
  })

  // Plan 008 regression. The pool used to be reported as the single largest holding
  // only, which is wrong the moment a deposit lands mid-window: the deposited CBTC
  // arrives as its OWN operator holding while the vault's totalPooledCbtc counts
  // both, so locking the largest one alone can never cover the pool. The lock handler
  // needs every piece in order to consolidate them first.
  test('reports every operator CBTC holding, not only the largest', async () => {
    const r = await readTick(
      stubSession({
        'Vault:Vault': [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Open' } }],
        'Allocation:Holding': [
          {
            contractId: '00deposited',
            payload: { owner: 'operator', instrument: 'CBTC', amount: '0.5' },
          },
          {
            contractId: '00pool',
            payload: { owner: 'operator', instrument: 'CBTC', amount: '3.0' },
          },
          {
            contractId: '00alice-wallet',
            payload: { owner: 'alice', instrument: 'CBTC', amount: '2.0' },
          },
          {
            contractId: '00cash',
            payload: { owner: 'operator', instrument: 'mUSDC', amount: '100.0' },
          },
        ],
      }),
      cfg,
      5_000,
    )

    // Largest first, so the merge target is the biggest holding and the cid the
    // existing single-holding path picks stays the head of the list.
    expect(r?.poolHoldingCids).toEqual(['00pool', '00deposited'])
    expect(r?.poolHoldingCid).toBe('00pool')
  })
})

describe('tick read coherence', () => {
  // M4 regression. readTick assembles TickReads from ten ACS queries. If each resolved
  // the ledger end itself they could land on ten different offsets and describe a
  // state the ledger never had, e.g. a vault from before a deposit alongside the
  // positions from after it. Every money-moving choice re-validates at commit time so
  // this fails closed rather than mispaying, but it costs retries and, where a holding
  // is picked by size, can wedge on a stale choice.
  test('pins every query in a tick to a single ledger offset', async () => {
    const offsets: number[] = []
    let ends = 0
    const session = {
      ledgerEnd: () => {
        ends += 1
        // A moving ledger end: if readTick resolved it per query, the reads below
        // would spread across increasing offsets.
        return Promise.resolve(ends)
      },
      queryAt: (offset: number, _party: string, module: string, template: string) => {
        offsets.push(offset)
        return module === 'Vault' && template === 'Vault'
          ? [{ contractId: '00v', payload: { epochNumber: '1', windowState: 'Open' } }]
          : []
      },
    } as unknown as LedgerSession

    await readTick(session, cfg)

    expect(offsets.length).toBeGreaterThan(1)
    expect(new Set(offsets).size).toBe(1)
    expect(ends).toBe(1)
  })
})
