// Shared fixtures for the settle-path handler tests: config, baseline tick reads,
// and a session recorder that captures submissions (including disclosed contracts).

import type { SchedulerConfig } from './config'
import type { HandlerCtx } from './handlers'
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
  module: string
  template: string
  contractId: string
  choice: string
  choiceArgument: Record<string, unknown>
  actAs: string[]
  disclosed?: unknown
}
export function recorder(): {
  session: { exercise: (a: Call & Record<string, unknown>) => unknown }
  calls: Call[]
} {
  const calls: Call[] = []
  return {
    calls,
    session: {
      exercise: (a) => {
        calls.push({
          module: a.module,
          template: a.template,
          contractId: a.contractId,
          choice: a.choice,
          choiceArgument: a.choiceArgument,
          actAs: a.actAs,
          disclosed: a.disclosed,
        })
        return { created: [], exerciseResult: null }
      },
    },
  }
}

export const base: TickReads = {
  now: 10_000,
  vaultCid: '00v',
  vaultEpoch: 1,
  windowState: 'Locked',
  workingEpoch: 1,
  isLeftover: false,
  positions: [],
  allocationPresent: true,
  receiptCids: [],
  receiptDepositors: [],
  receiptTotalUsdc: 0,
  reportPresent: false,
}
