import { expect, test } from 'bun:test'
import { WithdrawToggle } from '@/components/withdraw-toggle'
import { renderMarkup } from '@/test/render'

test('a queued position reads as queued and offers no action', () => {
  const html = renderMarkup(<WithdrawToggle positionCid="cid-1" queued={true} />)
  expect(html).toContain('Queued for next epoch')
  expect(html).not.toContain('<button')
})

test('a position someone else owns shows status, never a button they cannot honor', () => {
  // QueueWithdraw is controller depositor, so a non-owner could never submit it.
  const html = renderMarkup(<WithdrawToggle positionCid="cid-1" queued={false} owned={false} />)
  expect(html).toContain('Rolls to next epoch')
  expect(html).not.toContain('<button')
})

test('the owner sees what queuing will do before committing to it', () => {
  const html = renderMarkup(<WithdrawToggle positionCid="cid-1" queued={false} owned={true} />)
  expect(html).toContain('Queue withdrawal')
  expect(html).toContain('principal returns at the end of the current epoch')
})
