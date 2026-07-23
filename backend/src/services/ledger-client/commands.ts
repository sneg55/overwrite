// JSON Ledger API v2 request builders. Shapes verified against BitSafe's public
// api-collections (Yaak) used against this exact devnet, Canton 3.5.6:
//
//   POST /v2/commands/submit-and-wait-for-transaction
//     { "commands": { actAs, commandId, disclosedContracts, commands: [ ... ] } }
//     command = { CreateCommand: { templateId, createArguments } }
//             | { ExerciseCommand: { templateId, contractId, choice, choiceArgument } }
//
//   POST /v2/state/active-contracts
//     { verbose, activeAtOffset, filter: { filtersByParty: { <party>: { cumulative:
//       [ { identifierFilter: { TemplateFilter: { value: { templateId,
//           includeCreatedEventBlob } } } } ] } } } }
//
// templateId uses the package-name reference form: `#<package-name>:<Module>:<Template>`,
// e.g. `#overwrite-vault:Overwrite.Vault:Vault`.

import type { DisclosedContract } from '../registry-client/types'

export type LedgerCommand =
  | { CreateCommand: { templateId: string; createArguments: Record<string, unknown> } }
  | {
      ExerciseCommand: {
        templateId: string
        contractId: string
        choice: string
        choiceArgument: Record<string, unknown>
      }
    }

export interface JsCommandsBody {
  commands: {
    actAs: string[]
    commandId: string
    disclosedContracts: DisclosedContract[]
    commands: LedgerCommand[]
    // On an authenticated ledger the user-id is taken from the token's claims (so
    // it is omitted, matching BitSafe's collection). Supply it explicitly when the
    // token does not carry one (e.g. a no-auth local sandbox).
    userId?: string
  }
}

function wrap(
  actAs: string[],
  commandId: string,
  command: LedgerCommand,
  userId?: string,
  disclosed: DisclosedContract[] = [],
): JsCommandsBody {
  const commands = { actAs, commandId, disclosedContracts: disclosed, commands: [command] }
  return { commands: userId === undefined ? commands : { ...commands, userId } }
}

export function createCommand(args: {
  templateId: string
  createArguments: Record<string, unknown>
  actAs: string[]
  commandId: string
  userId?: string
  // Contracts the registry demands but our party cannot see on its own ACS
  // (fetched via registry-client). Defaults to none.
  disclosed?: DisclosedContract[]
}): JsCommandsBody {
  return wrap(
    args.actAs,
    args.commandId,
    { CreateCommand: { templateId: args.templateId, createArguments: args.createArguments } },
    args.userId,
    args.disclosed,
  )
}

export function exerciseCommand(args: {
  templateId: string
  contractId: string
  choice: string
  choiceArgument: Record<string, unknown>
  actAs: string[]
  commandId: string
  userId?: string
  // Contracts the registry demands but our party cannot see on its own ACS
  // (fetched via registry-client). Defaults to none.
  disclosed?: DisclosedContract[]
}): JsCommandsBody {
  return wrap(
    args.actAs,
    args.commandId,
    {
      ExerciseCommand: {
        templateId: args.templateId,
        contractId: args.contractId,
        choice: args.choice,
        choiceArgument: args.choiceArgument,
      },
    },
    args.userId,
    args.disclosed,
  )
}

export interface AcsFilterBody {
  verbose: boolean
  activeAtOffset: number
  filter: {
    filtersByParty: Record<
      string,
      {
        cumulative: Array<{
          identifierFilter: {
            TemplateFilter: { value: { templateId: string; includeCreatedEventBlob: boolean } }
          }
        }>
      }
    >
  }
}

export function acsFilter(args: {
  party: string
  templateId: string
  activeAtOffset: number
}): AcsFilterBody {
  return {
    verbose: true,
    activeAtOffset: args.activeAtOffset,
    filter: {
      filtersByParty: {
        [args.party]: {
          cumulative: [
            {
              identifierFilter: {
                TemplateFilter: {
                  value: { templateId: args.templateId, includeCreatedEventBlob: true },
                },
              },
            },
          ],
        },
      },
    },
  }
}

/**
 * Package-name-referenced template id: `#overwrite-vault:Overwrite.<Module>:<Template>`.
 *
 * The leading `#name` resolves to the highest version in that package's upgrade lineage.
 * The name is `overwrite-vault`, not `overwrite`: the original `overwrite` lineage is
 * pinned on devnet at 0.1.0, whose settlement model used concrete mirror templates, and
 * the CIP-56 interface rebind is not a valid upgrade of it. `Overwrite.<Module>` is the
 * Daml module path and is unrelated to the package name.
 */
export function overwriteTemplateId(module: string, template: string): string {
  return `#overwrite-vault:Overwrite.${module}:${template}`
}
