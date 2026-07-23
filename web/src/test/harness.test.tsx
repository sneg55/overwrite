import { expect, test } from 'bun:test'
import { formatCbtc } from '@/lib/format'
import { renderMarkup } from '@/test/render'

test('pure lib import resolves through the @ alias', () => {
  expect(formatCbtc(3)).toBe('3 CBTC')
})

test('renderMarkup produces static HTML', () => {
  const html = renderMarkup(<p className="probe">hi {'alice'}</p>)
  expect(html).toBe('<p class="probe">hi alice</p>')
})
