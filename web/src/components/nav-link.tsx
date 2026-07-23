'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Marks the current route with aria-current, which also drives the active style. */
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname()
  const active = pathname === href
  return (
    <Link className="nav-link" href={href} aria-current={active ? 'page' : undefined}>
      {children}
    </Link>
  )
}
