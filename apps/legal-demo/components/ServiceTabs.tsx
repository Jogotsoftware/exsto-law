'use client'

// Shared tab bar for the service editor: Settings · Questionnaire · Templates ·
// (Prompt, only for AI-draft services) · Workflow · Billing. Rendered by the
// /attorney/services/[serviceKey] layout so every panel of one service feels like
// one editor instead of separate pages, and always shown so the attorney can move
// freely between panels. The Prompt tab appears only for AI-draft services. Styled
// via the shared .nav-tabs classes (globals.css), same as MatterTabs / CrmTabs.
import Link from 'next/link'
import { usePathname } from 'next/navigation'

type GenerationMode = 'template_merge' | 'ai_draft'

export function ServiceTabs({
  serviceKey,
  generationMode,
}: {
  serviceKey: string
  generationMode: GenerationMode
}) {
  const pathname = usePathname()
  const base = `/attorney/services/${serviceKey}`
  const tabs: Array<{ href: string; label: string }> = [
    { href: base, label: 'Settings' },
    { href: `${base}/questionnaire`, label: 'Questionnaire' },
    { href: `${base}/templates`, label: 'Templates' },
    ...(generationMode === 'ai_draft' ? [{ href: `${base}/prompt`, label: 'Prompt' }] : []),
    // AI review of client-uploaded documents — orthogonal to how the service's
    // own documents are generated, so it shows for every service.
    { href: `${base}/review`, label: 'AI review' },
    { href: `${base}/workflow`, label: 'Workflow' },
    { href: `${base}/billing`, label: 'Billing' },
  ]
  // Longest-prefix match: the Settings href (base) is a prefix of every other tab,
  // so on a sub-tab both would match — pick the most specific so only one lights.
  const activeHref = tabs
    .filter((t) => pathname === t.href || pathname.startsWith(t.href + '/'))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href

  return (
    <nav className="nav-tabs" aria-label="Service editor">
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
