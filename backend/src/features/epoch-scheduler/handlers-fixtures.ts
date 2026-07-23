// Shared fixtures for the scheduler handler tests: a config, a baseline set of tick
// reads, and a session recorder that captures submissions instead of sending them.
// Split out so handlers.test.ts and handlers-lock.test.ts share one definition.

import { createHash } from 'node:crypto'
import type { ParsedTx } from '@/services/ledger-client/tx'
import type { SchedulerConfig } from './config'
import type { TickReads } from './reads'

export const cfg: SchedulerConfig = {
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

export interface Call {
  contractId: string
  choice: string
  choiceArgument: Record<string, unknown>
  actAs: string[]
  commandId: string
  disclosed?: unknown
}

// Session stub recording exercises. Split returns two holdings so the payout loop
// can carve chunks, Merge returns the one holding it folds them into (as the real
// choice does), and every other exercise returns an empty tx.
export function recorder(): {
  session: { exercise: (a: Call & Record<string, unknown>) => ParsedTx }
  calls: Call[]
} {
  const calls: Call[] = []
  let n = 0
  return {
    calls,
    session: {
      exercise: (a) => {
        calls.push({
          contractId: a.contractId,
          choice: a.choice,
          choiceArgument: a.choiceArgument,
          actAs: a.actAs,
          commandId: a.commandId,
          disclosed: a.disclosed,
        })
        if (a.choice === 'Merge') {
          n += 1
          return {
            created: [
              {
                templateId: 'p:Overwrite.Allocation:Holding',
                contractId: `merged${n}`,
                payload: {},
              },
            ],
            exerciseResult: `merged${n}`,
          }
        }
        if (a.choice === 'Split') {
          n += 1
          return {
            created: [
              {
                templateId: 'p:Overwrite.Allocation:Holding',
                contractId: `chunk${n}`,
                payload: {},
              },
              { templateId: 'p:Overwrite.Allocation:Holding', contractId: `rem${n}`, payload: {} },
            ],
            exerciseResult: null,
          }
        }
        return { created: [], exerciseResult: null }
      },
    },
  }
}

export const baseReads: TickReads = {
  now: 1_000,
  vaultCid: '00v',
  vaultEpoch: 1,
  windowState: 'Open',
  workingEpoch: 1,
  isLeftover: false,
  positions: [],
  allocationPresent: false,
  receiptCids: [],
  receiptDepositors: [],
  receiptTotalUsdc: 0,
  reportPresent: false,
}
