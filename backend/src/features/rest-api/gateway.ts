// Ledger gateway: turns REST intents into JSON Ledger API v2 calls. Two auth modes:
//   * devnet: `oidc` set -> a cached Keycloak bearer token; the token carries the
//     user-id, so command bodies omit it.
//   * local sandbox: `userId` set, no `oidc` -> an empty bearer (no-auth ledger) and
//     the user-id supplied in the command body instead.
// Exactly one mode is configured at the entrypoint. Reads work in both (an empty
// bearer is simply omitted); only command submission needs the user-id.

import { AppError, ErrorIds } from '@/constants/errorIds'
import { keycloakPasswordGrant, type OidcConfig, TokenCache } from '@/services/ledger-client/auth'
import { getLedgerEnd, queryActiveContracts, submitAndWait } from '@/services/ledger-client/client'
import { acsFilter, exerciseCommand, overwriteTemplateId } from '@/services/ledger-client/commands'
import { type ActiveContract, parseActiveContracts } from '@/services/ledger-client/parse'
import { createdOf, parseTx } from '@/services/ledger-client/tx'
import type { LedgerConfig } from '@/services/ledger-client/types'
import { depositRealWhole } from './deposit-real'

const AMOUNT_EPSILON = 1e-9

export interface GatewayConfig {
  ledger: LedgerConfig
  operatorParty: string
  /** Devnet mode: fetch a bearer token from Keycloak. Omit for local no-auth. */
  oidc?: OidcConfig
  /** Local no-auth mode: user-id put in each command body (e.g. participant_admin). */
  userId?: string
  /** Devnet: source and move real CBTC via the registry. Off keeps the local mock path. */
  useRealRegistry?: boolean
  /** Registry base URL (real mode only). */
  registryUrl?: string
  /** CBTC instrument admin / registrar party (real mode only). */
  registrar?: string
}

export class LedgerGateway {
  private readonly cfg: GatewayConfig
  private readonly cache: TokenCache | undefined

  constructor(cfg: GatewayConfig) {
    this.cfg = cfg
    this.cache =
      cfg.oidc === undefined
        ? undefined
        : new TokenCache(() => keycloakPasswordGrant(cfg.oidc as OidcConfig))
  }

  /** Bearer token: from the OIDC cache (devnet) or empty (local no-auth ledger). */
  private async token(): Promise<string> {
    return this.cache === undefined ? '' : await this.cache.get()
  }

  /** Active contracts of an Overwrite template, scoped to `party` (the privacy seam). */
  async activeContracts(
    party: string,
    module: string,
    template: string,
  ): Promise<ActiveContract[]> {
    const token = await this.token()
    const offset = await getLedgerEnd(this.cfg.ledger, token)
    const body = acsFilter({
      party,
      templateId: overwriteTemplateId(module, template),
      activeAtOffset: offset,
    })
    return parseActiveContracts(await queryActiveContracts(this.cfg.ledger, token, body))
  }

  /** Depositor queues a withdrawal on their own VaultPosition. */
  async queueWithdraw(party: string, positionCid: string): Promise<unknown> {
    const token = await this.token()
    const body = exerciseCommand({
      templateId: overwriteTemplateId('VaultPosition', 'VaultPosition'),
      contractId: positionCid,
      choice: 'QueueWithdraw',
      choiceArgument: {},
      actAs: [party],
      commandId: `qw-${positionCid}`,
      userId: this.cfg.userId,
    })
    return await submitAndWait(this.cfg.ledger, token, body)
  }

  /**
   * The depositor's existing position for the vault's CURRENT epoch, or null.
   *
   * The vault holds at most one VaultPosition per depositor per epoch: `RecordEpoch`
   * asserts `unique depositors`, so a second position makes the epoch unrecordable and
   * the scheduler then fails on every tick with the vault stuck for good.
   * `Vault.Deposit` therefore folds a repeat deposit into the existing position, and
   * needs to be told which one, because Daml cannot query the active contract set.
   *
   * Only the current epoch qualifies. Daml refuses a cross-epoch top-up outright, so
   * naming a rolled position would turn an ordinary deposit into a rejected command.
   * Returning null is the first-time-depositor case and creates a fresh position.
   */
  private async topUpTarget(depositor: string, vaultCid: string): Promise<string | null> {
    const vaults = await this.activeContracts(this.cfg.operatorParty, 'Vault', 'Vault')
    const vault = vaults.find((v) => v.contractId === vaultCid) ?? vaults[0]
    if (vault === undefined) return null // no readable vault: let Daml reject the deposit
    const epoch = String(vault.payload.epochNumber)
    const positions = await this.activeContracts(depositor, 'VaultPosition', 'VaultPosition')
    const mine = positions.find(
      (p) => String(p.payload.depositor) === depositor && String(p.payload.epochNumber) === epoch,
    )
    return mine?.contractId ?? null
  }

  /**
   * Custodial deposit: actAs [depositor, operator] exercising Vault.Deposit.
   * Deposit is consuming: it archives `vaultCid` and creates a new Vault with the
   * pooled total advanced. The caller must re-read the vault cid (GET /current-vault)
   * before the next write; this method does not cache or chain off the old cid.
   */
  async deposit(depositor: string, vaultCid: string, cbtcCid: string): Promise<unknown> {
    const topUp = await this.topUpTarget(depositor, vaultCid)
    return await this.submitDeposit(depositor, vaultCid, cbtcCid, topUp)
  }

  /** The Vault.Deposit submission itself, with the top-up target already resolved. */
  private async submitDeposit(
    depositor: string,
    vaultCid: string,
    cbtcCid: string,
    topUpPositionCid: string | null,
  ): Promise<unknown> {
    const token = await this.token()
    const body = exerciseCommand({
      templateId: overwriteTemplateId('Vault', 'Vault'),
      contractId: vaultCid,
      choice: 'Deposit',
      // Daml-LF JSON encodes Optional as the bare value, or null for None.
      choiceArgument: { depositor, cbtcCid, topUpPositionCid },
      actAs: [depositor, this.cfg.operatorParty],
      commandId: `dep-${cbtcCid}`,
      userId: this.cfg.userId,
    })
    return await submitAndWait(this.cfg.ledger, token, body)
  }

  /**
   * Amount-aware deposit. Depositing the whole holding is Vault.Deposit. Depositing
   * less first Splits the holding (controller = the depositor): the chunk carries the
   * requested amount and the remainder stays in the depositor's own wallet as change,
   * then the chunk is deposited. Split and Deposit are two submissions, so a crash
   * between them leaves the depositor holding both pieces (their own, summing to the
   * original): no value is lost, only fragmented, recoverable with Holding.Merge. This
   * mirrors the epoch-scheduler's split-then-pay pattern; an atomic split-deposit would
   * need a dedicated Daml choice (deferred: Vault.daml is at the file-size ceiling).
   * `amountCbtc` is passed through as a string so the Decimal keeps full precision.
   */
  async depositAmount(
    depositor: string,
    vaultCid: string,
    cbtcCid: string,
    amountCbtc: string,
  ): Promise<unknown> {
    const req = Number(amountCbtc)
    if (!Number.isFinite(req) || req <= 0) {
      throw new AppError(ErrorIds.DEP_BAD_AMOUNT, 'deposit amount must be a positive number', {
        amountCbtc,
      })
    }
    // Real mode moves real registry CBTC: source it, transfer to operator custody, and
    // record with Vault.RecordDeposit (whole-holding only, see depositRealWhole).
    if (this.cfg.useRealRegistry) {
      return await depositRealWhole(
        {
          ledger: this.cfg.ledger,
          token: () => this.token(),
          userId: this.cfg.userId,
          operator: this.cfg.operatorParty,
          registryUrl: this.cfg.registryUrl ?? '',
          registrar: this.cfg.registrar ?? '',
        },
        depositor,
        vaultCid,
        cbtcCid,
        amountCbtc,
        await this.topUpTarget(depositor, vaultCid),
      )
    }
    const holdings = await this.activeContracts(depositor, 'Allocation', 'Holding')
    const target = holdings.find((h) => h.contractId === cbtcCid)
    if (target === undefined) {
      throw new AppError(ErrorIds.DEP_HOLDING_NOT_FOUND, 'holding not found, or not owned by you', {
        cbtcCid,
      })
    }
    const full = Number(target.payload.amount)
    if (req > full + AMOUNT_EPSILON) {
      throw new AppError(ErrorIds.DEP_BAD_AMOUNT, 'deposit amount exceeds the holding balance', {
        amountCbtc,
        balance: full,
      })
    }
    // Within epsilon of the whole balance: no split, deposit the holding as-is.
    if (req >= full - AMOUNT_EPSILON) {
      return await this.deposit(depositor, vaultCid, cbtcCid)
    }
    // Partial: split off the requested amount (chunk owned by the depositor), deposit
    // the chunk, and leave the remainder in the depositor's wallet as change.
    const token = await this.token()
    const split = parseTx(
      await submitAndWait(
        this.cfg.ledger,
        token,
        exerciseCommand({
          templateId: overwriteTemplateId('Allocation', 'Holding'),
          contractId: cbtcCid,
          choice: 'Split',
          choiceArgument: { splitAmount: amountCbtc },
          actAs: [depositor],
          commandId: `dep-split-${cbtcCid}`,
          userId: this.cfg.userId,
        }),
      ),
    )
    const chunk = createdOf(split, 'Allocation', 'Holding')[0]?.contractId
    if (chunk === undefined) {
      throw new AppError(ErrorIds.DEP_SPLIT_FAILED, 'split produced no holding to deposit', {
        cbtcCid,
      })
    }
    return await this.deposit(depositor, vaultCid, chunk)
  }
}
