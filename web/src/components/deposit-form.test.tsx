import { expect, test } from 'bun:test'
import { DepositForm } from '@/components/deposit-form'
import { renderMarkup } from '@/test/render'

const HOLDINGS = [{ contractId: 'cid-1', amountCbtc: 2 }]

test('a closed window refuses the deposit in the form, naming the rule', () => {
  // Vault.daml enforces "deposit: window not open". Letting the amount through means
  // the write dies at the ledger with nothing on screen saying which rule was broken.
  const html = renderMarkup(
    <DepositForm holdings={HOLDINGS} windowState="Locked" minDepositCbtc="0.01" />,
  )
  expect(html).toContain('Deposits are closed')
  expect(html).not.toContain('Review deposit')
})

test('an open window renders the form', () => {
  const html = renderMarkup(
    <DepositForm holdings={HOLDINGS} windowState="Open" minDepositCbtc="0.01" />,
  )
  expect(html).toContain('Review deposit')
})

test('an unreadable window asserts nothing and leaves the form usable', () => {
  // Same precedent as minDepositCbtc: claiming a rule we could not read would be a
  // guess, so the server action is left to reject.
  const html = renderMarkup(<DepositForm holdings={HOLDINGS} minDepositCbtc="0.01" />)
  expect(html).toContain('Review deposit')
  expect(html).not.toContain('Deposits are closed')
})

test('an empty wallet points at the command that actually funds one', () => {
  const html = renderMarkup(<DepositForm holdings={[]} windowState="Open" />)
  expect(html).toContain('sandbox.sh seed')
})

test('the summary does not claim a fresh deposit is collateral for the current epoch', () => {
  // A mid-epoch deposit joins the pool immediately and is covered only from the next
  // call. The vault page already says so; this form used to contradict it.
  const html = renderMarkup(
    <DepositForm holdings={HOLDINGS} windowState="Open" principalCbtc={1} epochNumber={3} />,
  )
  expect(html).toContain('In the vault')
  expect(html).not.toContain('Locked as collateral')
})

test('the review dialog explains both settlement paths without overclaiming', () => {
  const html = renderMarkup(
    <DepositForm holdings={HOLDINGS} windowState="Open" principalCbtc={1} epochNumber={3} />,
  )
  expect(html).toContain('covered by a call from the next epoch')
  expect(html).toContain('The premium is yours either way')
  expect(html).not.toContain('collateral for the current epoch')
})

test('an empty wallet still leaves the depositor their vault total somewhere', () => {
  // The form early-returns on an empty wallet, which used to take the only copy of
  // the depositor's total with it. The page owns the total now, so this asserts the
  // form no longer claims to be its home.
  const html = renderMarkup(<DepositForm holdings={[]} windowState="Open" principalCbtc={3} />)
  expect(html).not.toContain('In the vault')
})
