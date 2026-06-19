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
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        borderBottom: '1px solid var(--border)',
        margin: '0 0 1.1rem',
      }}
    >
      {TABS.map((t) => {
        const active = isActive(t)
        return (
          <Link
            key={t.href}
            href={t.href}
            style={{
              padding: '0.5rem 0.95rem',
              marginBottom: '-1px',
              borderBottom: `2px solid ${active ? 'var(--text, #1a1a1a)' : 'transparent'}`,
              color: active ? 'var(--text, #1a1a1a)' : 'var(--muted)',
              fontWeight: active ? 600 : 400,
              textDecoration: 'none',
            }}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
