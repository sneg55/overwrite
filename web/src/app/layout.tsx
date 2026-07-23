import './globals.css'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'

export const metadata: Metadata = {
  // Routes under /app set a bare title ("Vault"); the template gives them the brand in
  // the browser tab. The landing page sets an `absolute` title so it is not doubled.
  title: { default: 'Overwrite', template: '%s · Overwrite' },
  description: 'CBTC covered-call vault on Canton. Institutional BTC yield with a book nobody can see.',
}

// Root layout is document-only: it wraps both the marketing landing at `/` and the app
// under /app. The app chrome (header, nav, party switcher) lives in the nested
// src/app/app/layout.tsx so it never renders on the marketing page.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
