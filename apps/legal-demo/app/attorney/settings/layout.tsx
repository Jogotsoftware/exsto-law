'use client'

// Settings sub-nav (S9 — WP9.3). Settings grew a second deep panel (Users &
// roles), so it gets a lightweight tab bar; each panel is a settings/<name> route.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/attorney/settings', label: 'Firm settings', exact: true },
  { href: '/attorney/settings/users', label: 'Users & roles' },
  { href: '/attorney/settings/ai-usage', label: 'AI usage' },
]

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isActive = (t: (typeof TABS)[number]) =>
    t.exact ? pathname === t.href : pathname.startsWith(t.href)

  return (
    <div>
      <nav className="settings-subnav">
        {TABS.map((t) => {
          const active = isActive(t)
          return (
            <Link
              key={t.href}
              href={t.href}
              className={active ? 'settings-tab is-active' : 'settings-tab'}
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
