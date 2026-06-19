'use client'

// Shared tab bar for the CRM section: Companies (the accounts), Clients
// (companies engaged as clients), and Contacts (the people). Rendered by the
// /attorney/crm layout and the contacts page so all three feel like one section.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: '/attorney/crm', label: 'Companies', exact: true },
  { href: '/attorney/crm/clients', label: 'Clients' },
  { href: '/attorney/contacts', label: 'Contacts' },
]

export function CrmTabs() {
  const pathname = usePathname()
  const isActive = (t: (typeof TABS)[number]) =>
    t.exact ? pathname === t.href : pathname.startsWith(t.href)
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
