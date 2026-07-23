// One shared, party-scoped wrapper over the JSON Ledger API client. All three engine
// processes (scheduler/oracle/mm) submit and read through this, so there is exactly
// one ledger seam. Two auth modes mirror the REST gateway: `oidc` -> cached bearer
// (devnet); `userId` -> empty bearer + user-id in the command body (local no-auth).

import type { DisclosedContract } from '../registry-client/types'
import { keycloakPasswordGrant, type OidcConfig, TokenCache } from './auth'
import { getLedgerEnd, queryActiveContracts, submitAndWait } from './client'
import { acsFilter, createCommand, exerciseCommand, overwriteTemplateId } from './commands'
import { type ActiveContract, parseActiveContracts } from './parse'
import { type ParsedTx, parseTx } from './tx'
import type { LedgerConfig } from './types'

export interface SessionConfig {
  ledger: LedgerConfig
  oidc?: OidcConfig
  userId?: string
}

let counter = 0
export function cmdId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export class LedgerSession {
  private readonly cfg: SessionConfig
  private readonly cache: TokenCache | undefined

  constructor(cfg: SessionConfig) {
    this.cfg = cfg
    this.cache =
      cfg.oidc === undefined
        ? undefined
        : new TokenCache(() => keycloakPasswordGrant(cfg.oidc as OidcConfig))
  }

  // Public so the registry client can authenticate its choice-context fetches with
  // the same bearer this session uses, rather than re-implementing auth.
  async token(): Promise<string> {
    return this.cache === undefined ? '' : await this.cache.get()
  }

  /** The current ledger end, for pinning a batch of reads to one offset. */
  async ledgerEnd(): Promise<number> {
    return await getLedgerEnd(this.cfg.ledger, await this.token())
  }

  async query(party: string, module: string, template: string): Promise<ActiveContract[]> {
    return await this.queryAt(await this.ledgerEnd(), party, module, template)
  }

  /**
   * Read one template's active contracts as of a CALLER-SUPPLIED offset.
   *
   * `query` resolves the ledger end itself, so a batch of `query` calls reads each
   * template at a different offset and can assemble a state that never existed: a
   * vault from before a deposit alongside the positions from after it. Every
   * money-moving choice re-validates against the live ledger at commit time, so a torn
   * read fails closed rather than mispaying, but it produces avoidable failed
   * submissions and, where a holding is picked by size, can wedge on a stale choice.
   * Callers that need a coherent snapshot resolve `ledgerEnd()` once and pass it here.
   */
  async queryAt(
    offset: number,
    party: string,
    module: string,
    template: string,
  ): Promise<ActiveContract[]> {
    const token = await this.token()
    const body = acsFilter({
      party,
      templateId: overwriteTemplateId(module, template),
      activeAtOffset: offset,
    })
    return parseActiveContracts(await queryActiveContracts(this.cfg.ledger, token, body))
  }

  /**
   * Read a raw (possibly foreign) template id's active contracts at a fixed offset.
   *
   * `queryAt` builds the template id with `overwriteTemplateId`, so it only reaches
   * this package's templates. Real-registry reads (CBTC holdings, transfer factory)
   * live in other packages, so they pass the fully-qualified package-name reference id
   * directly. Same party scoping and offset pinning as `queryAt`.
   */
  async queryRawAt(offset: number, party: string, templateId: string): Promise<ActiveContract[]> {
    const token = await this.token()
    const body = acsFilter({ party, templateId, activeAtOffset: offset })
    return parseActiveContracts(await queryActiveContracts(this.cfg.ledger, token, body))
  }

  async exercise(a: {
    module: string
    template: string
    contractId: string
    choice: string
    choiceArgument: Record<string, unknown>
    actAs: string[]
    commandId: string
    disclosed?: DisclosedContract[]
  }): Promise<ParsedTx> {
    const token = await this.token()
    const body = exerciseCommand({
      templateId: overwriteTemplateId(a.module, a.template),
      contractId: a.contractId,
      choice: a.choice,
      choiceArgument: a.choiceArgument,
      actAs: a.actAs,
      commandId: a.commandId,
      userId: this.cfg.userId,
      disclosed: a.disclosed,
    })
    return parseTx(await submitAndWait(this.cfg.ledger, token, body))
  }

  async create(a: {
    module: string
    template: string
    createArguments: Record<string, unknown>
    actAs: string[]
    commandId: string
    disclosed?: DisclosedContract[]
  }): Promise<ParsedTx> {
    const token = await this.token()
    const body = createCommand({
      templateId: overwriteTemplateId(a.module, a.template),
      createArguments: a.createArguments,
      actAs: a.actAs,
      commandId: a.commandId,
      userId: this.cfg.userId,
      disclosed: a.disclosed,
    })
    return parseTx(await submitAndWait(this.cfg.ledger, token, body))
  }
}
