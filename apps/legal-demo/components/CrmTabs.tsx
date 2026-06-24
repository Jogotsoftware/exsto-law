'use client'

// Shared tab bar for the CRM section: Clients (the accounts — the billing parent
// that groups contacts + matters) and Contacts (the people). Both live under the
// /attorney/crm layout, which renders this bar, so the two always feel like one
// section and you can never get stranded with no way back.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: Array<{ href: string; label: string }> = [
  { href: '/attorney/crm', label: 'Clients' },
  { href: '/attorney/crm/contacts', label: 'Contacts' },
]

export function CrmTabs() {
  const pathname = usePathname()
  // Longest-prefix match: '/attorney/crm' is a prefix of '/attorney/crm/contacts',
  // so on a contact (or contact-detail) path BOTH would match — pick the most
  // specific. This keeps Clients lit on client-detail pages (/attorney/crm/<id>)
  // while Contacts owns everything under /attorney/crm/contacts.
  const activeHref = TABS.filter(
    (t) => pathname === t.href || pathname.startsWith(t.href + '/'),
  ).sort((a, b) => b.href.length - a.href.length)[0]?.href
  const isActive = (t: (typeof TABS)[number]) => t.href === activeHref
  return (
    <nav className="nav-tabs" aria-label="CRM">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={isActive(t) ? 'is-active' : undefined}
          aria-current={isActive(t) ? 'page' : undefined}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
