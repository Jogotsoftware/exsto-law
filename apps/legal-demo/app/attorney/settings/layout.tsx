'use client'

// Settings sub-nav (S9 — WP9.3). Settings grew a second deep panel (Users &
// roles), so it gets a lightweight tab bar; each panel is a settings/<name> route.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/attorney/settings', label: 'Firm settings', exact: true },
  { href: '/attorney/settings/users', label: 'Users & roles' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = (t: (typeof TABS)[number]) =>
    t.exact ? pathname === t.href : pathname.startsWith(t.href)

  return (
    <div>
      <nav
        className="settings-subnav"
        style={{
          display: 'flex',
          gap: 4,
          marginBottom: '1rem',
          borderBottom: '1px solid var(--border, #e3e8ef)',
        }}
      >
        {TABS.map((t) => {
          const active = isActive(t)
          return (
            <Link
              key={t.href}
              href={t.href}
              style={{
                padding: '0.55rem 0.9rem',
                fontSize: '0.9rem',
                fontWeight: active ? 600 : 500,
                color: active ? 'var(--accent, #1b2a41)' : 'var(--muted, #64748b)',
                borderBottom: active ? '2px solid var(--accent, #1b2a41)' : '2px solid transparent',
                marginBottom: -1,
              }}
            >
              {t.label}
            </Link>
          )
        })}
      </nav>
      {children}
    </div>
  )
}
