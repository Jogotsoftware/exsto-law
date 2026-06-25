'use client'

// Shared tab bar for the matter editor: Overview · Activity · Documents · Tasks ·
// Billing. Rendered by the /attorney/matters/[id] layout so the matter's panels
// feel like one workspace instead of one long scroll.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function MatterTabs({ matterEntityId }: { matterEntityId: string }) {
  const pathname = usePathname()
  const base = `/attorney/matters/${matterEntityId}`
  const tabs: Array<{ href: string; label: string }> = [
    { href: base, label: 'Overview' },
    { href: `${base}/activity`, label: 'Activity' },
    { href: `${base}/documents`, label: 'Documents' },
    { href: `${base}/tasks`, label: 'Tasks' },
    { href: `${base}/billing`, label: 'Billing' },
  ]
  // Longest-prefix match so Overview (base) doesn't also light up on sub-tabs.
  const activeHref = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <nav className="nav-tabs" aria-label="Matter workspace">
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
