// View models for the UI. Each mirrors an on-ledger contract as a party-scoped
// projection. Shapes are produced in lib/ledger-view.ts from the REST backend's
// party-scoped ACS, never from demo data. A field is either genuinely read from a
// contract the party observes, or explicitly 'unknown'; the UI never fills a gap
// with a guess (see commit e7b6bae).

export interface VaultView {
  // The CallOption's covered notional. For a fully-covered call this equals the
  // locked collateral by construction; the UI labels it as the covered notional,
  // not an independently observed TVL number.
  notionalCbtc: number
  epochNumber: number
  strikeUsdPerCbtc: number
  premiumUsdc: number
  optionState: 'Written' | 'Active' | 'Settled' | 'unknown'
  expiryIso: string
}

// The deposit-window state lives on the Vault template, which only the operator
// observes. Read separately from the CallOption-sourced VaultView.
export interface VaultWindowView {
  epochNumber: number
  windowState: 'Open' | 'Locked' | 'Settling' | 'unknown'
  /**
   * Total CBTC pooled in the vault. This is NOT the same as the live call's notional:
   * a deposit made mid-epoch joins the pool immediately but is only covered by a call
   * from the next epoch, so pooled >= notional whenever the window reopens.
   */
  pooledCbtc: number
}

export interface PositionView {
  // Needed to exercise QueueWithdraw on this exact position.
  contractId: string
  depositor: string
  principalCbtc: number
  epochNumber: number
  withdrawQueued: boolean
}

export interface ReceiptView {
  depositor: string
  epochNumber: number
  premiumPaidUsdc: number
}

// A free CBTC holding the party owns but has NOT locked in the vault: their wallet
// balance, available to deposit. Read party-scoped from /holdings (which only ever
// returns CBTC the caller owns), so a depositor sees their own wallet, no one else's.
export interface HoldingView {
  contractId: string
  amountCbtc: number
  instrument: string
}

export interface EpochReportView {
  epochNumber: number
  settlementPath: 'OTM' | 'ITM' | 'unknown'
  totalPremiumUsdc: number
  totalNotionalCbtc: number
  depositorCount: number
  collateralReturned: boolean
  /**
   * The settlement price and strike this epoch was decided against, copied onto the
   * report so a depositor can read them: EpochSettlement itself is signatory
   * operator, mmBuyer and invisible to them.
   *
   * Null for reports written by overwrite-vault 1.0.0, which had no such field. Null
   * is not zero and must never render as a price.
   */
  observedPrice: number | null
  strikeUsdcPerCbtc: number | null
}
