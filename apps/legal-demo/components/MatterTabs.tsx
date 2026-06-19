'use client'

// Shared tab bar for the matter editor: Overview · Activity · Documents · Billing.
// Rendered by the /attorney/matters/[id] layout so the matter's panels feel like
// one workspace instead of one long scroll.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function MatterTabs({ matterEntityId }: { matterEntityId: string }) {
  const pathname = usePathname()
  const base = `/attorney/matters/${matterEntityId}`
  const tabs: Array<{ href: string; label: string }> = [
    { href: base, label: 'Overview' },
    { href: `${base}/activity`, label: 'Activity' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/billing`, label: 'Billing' },
  ]
  // Longest-prefix match so Overview (base) doesn't also light up on sub-tabs.
  const activeHref = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <div
      style={{
        display: 'flex',
        gap: '0.25rem',
        borderBottom: '1px solid var(--border)',
        margin: '0 0 1.1rem',
      }}
    >
      {tabs.map((t) => {
        const active = t.href === activeHref
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
