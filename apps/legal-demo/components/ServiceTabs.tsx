'use client'

// Shared tab bar for the service editor: Settings · Questionnaire · Templates ·
// (Prompt, only for AI-draft services) · Workflow · Billing. Rendered by the
// /attorney/services/[serviceKey] layout so every panel of one service feels like
// one editor instead of separate pages. The Prompt tab appears only when the
// service generates documents via AI drafting (template-merge services don't use
// a prompt), so a template-merge service shows exactly five tabs. The Workflow tab
// (ADR 0045 PR4b) composes the service's lifecycle stage graph visually.
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
    { href: `${base}/workflow`, label: 'Workflow' },
    { href: `${base}/billing`, label: 'Billing' },
  ]
  // Longest-prefix match: the Settings href (base) is a prefix of every other tab,
  // so on a sub-tab both would match — pick the most specific so only one lights.
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
