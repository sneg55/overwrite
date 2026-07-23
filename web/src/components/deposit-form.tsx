'use client'

// The deposit form. The depositor types an amount to lock as collateral on a hero
// number field (empty on load; MAX fills the holding); a summary shows the collateral
// before/after, and a Review dialog is the deliberate confirm step before the on-chain
// write. No contract id is ever shown or typed: holdings are chosen by their balance,
// and the active vault cid is supplied by the operator config server-side. The summary
// reports collateral only, never a yield, APY, or projected earnings.

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { compareDecimal } from '@/lib/decimal'
import { type DepositState, submitDepositAction } from '@/lib/deposit-actions'
import { trapTabFocus } from '@/lib/focus-trap'
import { formatCbtc, formatEpoch } from '@/lib/format'

export interface WalletHolding {
  contractId: string
  amountCbtc: number
}

interface DepositFormProps {
  holdings: WalletHolding[]
  /** The depositor's collateral already locked in the vault, for the before/after row. */
  principalCbtc?: number
  /** Current epoch, shown as a fact when known. Omitted rather than guessed. */
  epochNumber?: number
  /**
   * The vault's minimum deposit as a decimal string. Undefined when the vault could not
   * be read, in which case no minimum is asserted client-side and the server action is
   * left to reject: claiming a minimum we could not read would be a guess.
   */
  minDepositCbtc?: string
  /**
   * The vault's deposit window. Vault.daml refuses a deposit unless this is Open,
   * so the form refuses first and names the rule. Undefined when the vault could not
   * be read, in which case nothing is asserted and the server action is left to
   * reject: the same precedent minDepositCbtc set.
   */
  windowState?: string
}

const INITIAL: DepositState = { status: 'idle', message: '' }

// Trim a float to a clean value MAX writes into the field (2 -> "2", 1.5 -> "1.5").
const toInput = (n: number): string => String(Number(n.toFixed(8)))

export function DepositForm({
  holdings,
  principalCbtc = 0,
  epochNumber,
  minDepositCbtc,
  windowState,
}: DepositFormProps) {
  const [state, action, pending] = useActionState(submitDepositAction, INITIAL)
  // Default to the largest holding, not whatever the ledger listed first. A wallet
  // fragments in normal use (a rejected deposit can leave a dust holding behind), and
  // defaulting to an arbitrary one showed "0.00000001 CBTC available" to a depositor
  // who actually held 1.5, with nothing on screen explaining why.
  const largest = useMemo(
    () =>
      holdings.reduce<WalletHolding | undefined>(
        (best, h) => (best === undefined || h.amountCbtc > best.amountCbtc ? h : best),
        undefined,
      ),
    [holdings],
  )
  const [selectedCid, setSelectedCid] = useState(largest?.contractId ?? '')
  const selected = useMemo(
    () => holdings.find((h) => h.contractId === selectedCid) ?? largest,
    [holdings, selectedCid, largest],
  )
  const max = selected?.amountCbtc ?? 0
  const [amount, setAmount] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  // Once the deposit commits, close the review and clear the field; the page revalidates
  // the wallet behind the dialog.
  useEffect(() => {
    if (state.status === 'ok') {
      dialogRef.current?.close()
      setAmount('')
    }
  }, [state.status])


  // A precondition rather than an amount problem, so it replaces the form rather than
  // joining the rejection ladder. There is no amount that would be accepted right now.
  if (windowState !== undefined && windowState !== 'Open') {
    return (
      <p className="field-hint">
        Deposits are closed right now. The window reopens when the current epoch settles.
      </p>
    )
  }

  if (holdings.length === 0 || selected === undefined) {
    return (
      <p className="field-hint">
        No CBTC in this wallet to deposit. Run <code>./scripts/sandbox.sh seed</code> to fund the
        demo parties.
      </p>
    )
  }

  // Why the amount is refused, or null when it is good. Previously this was a bare
  // boolean, so every rejection reason (over balance, zero, negative, below the vault
  // minimum) collapsed into one silently disabled button with nothing on screen to say
  // which rule was broken.
  const rejection = ((): string | null => {
    if (amount === '') return null
    if (compareDecimal(amount, '0') === null) return 'Enter an amount in CBTC, for example 0.25.'
    if (compareDecimal(amount, '0') !== 1) return 'Enter an amount greater than zero.'
    if (minDepositCbtc !== undefined && compareDecimal(amount, minDepositCbtc) === -1) {
      return `The vault's minimum deposit is ${formatCbtc(Number(minDepositCbtc))}.`
    }
    if (compareDecimal(amount, toInput(max)) === 1) {
      return `That is more than the ${formatCbtc(max)} in this holding.`
    }
    return null
  })()

  const valid = amount !== '' && rejection === null
  const deposited = valid ? Number(amount) : 0
  const lockedAfter = principalCbtc + deposited

  const collateralRow = (): React.JSX.Element => (
    <div className="deposit-fact">
      {/* "In the vault", not "Locked as collateral". A deposit made while the window is
          open joins the pool immediately but is not covered until the next call is
          written, which is exactly what the vault page's "Pooled, not yet covered" tile
          reports. Calling it locked collateral here contradicted that tile. */}
      <span className="deposit-fact-label">In the vault</span>
      <span className="deposit-fact-value">
        {formatCbtc(principalCbtc)}
        {deposited > 0 && (
          <>
            <span className="deposit-arrow" aria-hidden="true">
              &rarr;
            </span>
            {formatCbtc(lockedAfter)}
          </>
        )}
      </span>
    </div>
  )

  const epochRow = (): React.JSX.Element | null =>
    epochNumber === undefined ? null : (
      <div className="deposit-fact">
        <span className="deposit-fact-label">Epoch</span>
        <span className="deposit-fact-value">{formatEpoch(epochNumber)}</span>
      </div>
    )

  return (
    <form action={action} className="deposit">
      <input type="hidden" name="cbtcCid" value={selectedCid} />

      {holdings.length > 1 && (
        <div className="field">
          <label className="field-label" htmlFor="holding">
            Deposit from
          </label>
          <select
            className="field-input"
            id="holding"
            value={selectedCid}
            onChange={(e) => setSelectedCid(e.target.value)}
          >
            {holdings.map((h) => (
              <option key={h.contractId} value={h.contractId}>
                {formatCbtc(h.amountCbtc)} holding
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="deposit-panel">
        <label className="field-label" htmlFor="amountCbtc">
          Amount to deposit
        </label>
        <input
          className="deposit-amount"
          id="amountCbtc"
          name="amountCbtc"
          type="number"
          inputMode="decimal"
          min="0"
          max={max}
          step="any"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-describedby="deposit-avail"
          aria-invalid={rejection !== null}
          aria-errormessage={rejection === null ? undefined : 'deposit-rejection'}
          required
        />
        <div className="deposit-sub">
          <span id="deposit-avail">
            {formatCbtc(max)} available
            {minDepositCbtc !== undefined && `, ${formatCbtc(Number(minDepositCbtc))} minimum`}
          </span>
          <button type="button" className="deposit-max" onClick={() => setAmount(toInput(max))}>
            MAX
          </button>
        </div>
      </div>

      {/* The reason the amount is refused. Without it the submit button just went quiet
          and the user was left to guess which rule they had broken. */}
      {rejection !== null && (
        <p className="field-error" id="deposit-rejection" role="alert">
          {rejection}
        </p>
      )}

      <div className="deposit-panel deposit-facts">
        {collateralRow()}
        {epochRow()}
      </div>

      <button
        type="button"
        className="btn btn-primary btn-block"
        disabled={!valid}
        onClick={() => dialogRef.current?.showModal()}
      >
        Review deposit
      </button>

      <dialog
        ref={dialogRef}
        className="review-dialog"
        aria-labelledby="review-title"
        onKeyDown={(e) => {
          if (dialogRef.current !== null) trapTabFocus(dialogRef.current, e)
        }}
      >
        <div className="review-panel">
          <div className="review-head">
            <h2 className="review-title" id="review-title">
              Review deposit
            </h2>
            <button
              type="button"
              className="review-close"
              aria-label="Close review"
              onClick={() => dialogRef.current?.close()}
            >
              <span aria-hidden="true">&times;</span>
            </button>
          </div>

          <div className="review-card">
            <span className="review-brand">
              <span className="brand-mark" aria-hidden="true" />
              Overwrite CBTC vault
            </span>
            <span className="field-label">You deposit</span>
            <span className="review-amount">{formatCbtc(deposited)}</span>
            <div className="review-divider" />
            {collateralRow()}
            {epochRow()}
          </div>

          <p className="confirm-summary">
            This deposits {formatCbtc(deposited)} into the vault. It joins the pool immediately and
            is covered by a call from the next epoch. If that call expires out of the money, your
            collateral is released back to you. If it is exercised, the collateral is delivered at
            the strike. The premium is yours either way.
          </p>

          <button className="btn btn-primary btn-block" type="submit" disabled={pending || !valid}>
            {pending ? 'Submitting...' : 'Confirm deposit'}
          </button>
          <span className="action-status" data-status={state.status} role="status" aria-live="polite">
            {state.status === 'error' ? state.message : ''}
          </span>
        </div>
      </dialog>

      {/* The confirmed deposit, announced on the page rather than in the dialog: the
          dialog closes on success, so a message rendered inside it is destroyed at the
          moment it becomes true. The server action has always returned this message;
          nothing rendered it, so an on-chain write finished with no acknowledgement at
          all and the user had to infer it from the balance changing. */}
      <span className="action-status" data-status={state.status} role="status" aria-live="polite">
        {state.status === 'ok' ? state.message : ''}
      </span>
    </form>
  )
}
