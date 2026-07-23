// Input guards for the real-CBTC deposit path.

import { AppError, ErrorIds } from '@/constants/errorIds'

// Whole-holding guard for the real deposit path. Partial real deposits would need a
// registry split (deferred), so the requested amount must equal the whole holding.
export function assertWholeHolding(amountCbtc: string, holdingAmount: string): void {
  if (Math.abs(Number(amountCbtc) - Number(holdingAmount)) > 1e-9) {
    throw new AppError(
      ErrorIds.DEP_BAD_AMOUNT,
      'partial real-CBTC deposits are not supported yet; deposit the whole holding',
      { amountCbtc, balance: holdingAmount },
    )
  }
}
