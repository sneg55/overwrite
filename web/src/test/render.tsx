// Test-only. Renders a React element to static HTML so tests can assert markup
// without a DOM. Not imported by any app route, so it never enters the Next bundle.
import type { ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

export function renderMarkup(el: ReactElement): string {
  return renderToStaticMarkup(el)
}
