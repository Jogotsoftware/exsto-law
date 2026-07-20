'use client'

import { ScaleIcon } from '@/components/icons'
import { LanguageToggle } from '@/components/LanguageToggle'

// Shared brand header for every .bk-shell surface (the wizard, the standalone
// front door, and the chooser) — one crest + firm-name treatment so the funnel
// reads as one product regardless of entry point.
export function BookTopbar({
  firmName,
  showLanguageToggle = true,
}: {
  firmName: string | null
  // The standalone /book/[slug] front door has no i18n plumbing yet — a
  // working toggle there would flip a UI control that translates nothing.
  showLanguageToggle?: boolean
}) {
  return (
    <header className="bk-topbar">
      <div className="bk-brand">
        <span className="bk-brand-mark">
          <ScaleIcon size={18} />
        </span>
        {/* Resolved firm name (MULTI-TENANT-1). Blank until firm_branding lands —
            a real firm always resolves a name, so this fills within a beat. */}
        <span className="bk-brand-name">{firmName ?? ''}</span>
      </div>
      {showLanguageToggle && <LanguageToggle />}
    </header>
  )
}
