'use client'

import { ScaleIcon } from '@/components/icons'
import { LanguageToggle } from '@/components/LanguageToggle'
import { isHexColor } from '@/lib/brandColor'

// Shared brand header for every .bk-shell surface (the wizard, the standalone
// front door, and the chooser) — one crest + firm-name treatment so the funnel
// reads as one product regardless of entry point. UIWALK-2: when the firm has
// set a brand color (legal.public.firm_branding), the crest tints to it.
// FIRM-BRANDING-1: and when the firm has uploaded a LOGO, it replaces the crest
// + wordmark entirely — a prospective client's first screen shows the firm's
// own mark, the same one on the console header, the portal and the invoice.
export function BookTopbar({
  firmName,
  brandColor = null,
  logoDataUrl = null,
  showLanguageToggle = true,
}: {
  firmName: string | null
  // The firm's #rrggbb brand color (server-validated); null = product default.
  brandColor?: string | null
  // The firm's logo as an image data URL (server-validated); null = crest.
  logoDataUrl?: string | null
  // The standalone /book/[slug] front door has no i18n plumbing yet — a
  // working toggle there would flip a UI control that translates nothing.
  showLanguageToggle?: boolean
}) {
  return (
    <header className="bk-topbar">
      <div className="bk-brand">
        {logoDataUrl ? (
          <img src={logoDataUrl} alt={firmName ?? 'Firm logo'} className="bk-brand-logo" />
        ) : (
          <>
            <span
              className="bk-brand-mark"
              style={isHexColor(brandColor) ? { background: brandColor } : undefined}
            >
              <ScaleIcon size={18} />
            </span>
            {/* Resolved firm name (MULTI-TENANT-1). Blank until firm_branding
                lands — a real firm always resolves a name, so this fills within
                a beat. */}
            <span className="bk-brand-name">{firmName ?? ''}</span>
          </>
        )}
      </div>
      {showLanguageToggle && <LanguageToggle />}
    </header>
  )
}
