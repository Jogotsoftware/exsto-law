'use client'

// Shared link-tab bar (.nav-tabs) used by the CRM, matter-editor and
// service-editor sections. One implementation of the longest-prefix-match
// active rule: a base href ('/attorney/crm', the matter overview, the service
// settings tab) is a prefix of every sibling, so on a sub-path BOTH match —
// picking the most specific keeps exactly one tab lit.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export interface NavTabSpec {
  href: string
  label: string
}

export function NavTabs({
  tabs,
  ariaLabel,
  className,
}: {
  tabs: NavTabSpec[]
  ariaLabel: string
  /** Extra class appended alongside `nav-tabs` (e.g. a surface-specific restyle
   *  that must not affect the other `.nav-tabs` consumers — CRM, service editor). */
  className?: string
}) {
  const pathname = usePathname()
  const activeHref = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href
  return (
    <nav className={className ? `nav-tabs ${className}` : 'nav-tabs'} aria-label={ariaLabel}>
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={t.href === activeHref ? 'is-active' : undefined}
          aria-current={t.href === activeHref ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
