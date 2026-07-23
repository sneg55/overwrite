// Command-building plumbing for the demo seed: thin create/exercise wrappers over the
// ledger-client command builders, so index.ts reads as the seed narrative rather than
// as raw JSON submissions. Kept separate to keep the seed under the file-size limit and
// to isolate the one place that knows the `#overwrite-vault:Overwrite.<module>:<template>`
// identifier shape.
import { createCommand, exerciseCommand } from '../../backend/src/services/ledger-client/commands'
import { type SubmitResult, submit, USER_ID } from '../demo-scenario/ledger'

export const tid = (m: string, t: string): string => `#overwrite-vault:Overwrite.${m}:${t}`

export interface CreateSpec {
  m: string
  t: string
  args: Record<string, unknown>
  actAs: string[]
  id: string
}
export interface ExSpec {
  m: string
  t: string
  cid: string
  choice: string
  arg: Record<string, unknown>
  actAs: string[]
  id: string
}

export const create = (s: CreateSpec): Promise<SubmitResult> =>
  submit(
    createCommand({
      templateId: tid(s.m, s.t),
      createArguments: s.args,
      actAs: s.actAs,
      commandId: s.id,
      userId: USER_ID,
    }),
  )

export const exercise = (s: ExSpec): Promise<SubmitResult> =>
  submit(
    exerciseCommand({
      templateId: tid(s.m, s.t),
      contractId: s.cid,
      choice: s.choice,
      choiceArgument: s.arg,
      actAs: s.actAs,
      commandId: s.id,
      userId: USER_ID,
    }),
  )
