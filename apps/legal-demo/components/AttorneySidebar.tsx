'use client'

// WP8 UI standard: Clio-style conservative left sidebar — Dashboard, Matters,
// Review, Calendar, Mail, Settings. Muted navy/gray, lawyerly trust.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  { href: '/attorney', label: 'Dashboard', exact: true },
  { href: '/attorney/matters', label: 'Matters' },
  { href: '/attorney/contacts', label: 'Contacts' },
  { href: '/attorney/review', label: 'Review' },
  { href: '/attorney/calendar', label: 'Calendar' },
  { href: '/attorney/mail', label: 'Mail' },
  { href: '/attorney/services', label: 'Services' },
  { href: '/attorney/settings', label: 'Settings' },
]

export function AttorneySidebar() {
  const pathname = usePathname()
  const isActive = (item: (typeof NAV)[number]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  return (
    <aside
      style={{
        width: 216,
        minWidth: 216,
        minHeight: '100vh',
        background: 'linear-gradient(180deg, #0f2143 0%, #16335f 100%)',
        boxShadow: '1px 0 0 rgba(255,255,255,0.05), 4px 0 24px -12px rgba(15,23,42,0.4)',
        color: '#cdd6e3',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        alignSelf: 'flex-start',
        height: '100vh',
      }}
    >
      <Link
        href="/attorney"
        style={{
          display: 'block',
          padding: '1.1rem 1.25rem',
          color: '#ffffff',
          fontFamily: 'var(--font-serif, Georgia, serif)',
          fontWeight: 600,
          fontSize: '1.25rem',
          letterSpacing: '0',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        Pacheco Law
      </Link>
      <nav style={{ display: 'flex', flexDirection: 'column', padding: '0.75rem 0' }}>
        {NAV.map((item) => {
          const active = isActive(item)
          return (
            <Link
              key={item.href}
              href={item.href}
              style={{
                padding: '0.6rem 1.25rem',
                color: active ? '#ffffff' : '#aeb9c9',
                background: active ? 'rgba(255,255,255,0.09)' : 'transparent',
                borderLeft: active ? '3px solid #d08a3e' : '3px solid transparent',
                fontWeight: active ? 600 : 400,
                fontSize: '0.92rem',
              }}
            >
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div
        style={{
          marginTop: 'auto',
          padding: '1rem 1.25rem',
          fontSize: '0.75rem',
          color: '#7e8da0',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        }}
      >
        AI-native practice
        <br />
        on the Exsto substrate
      </div>
    </aside>
  )
}
