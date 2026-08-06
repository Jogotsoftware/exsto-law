'use client'

import Link from 'next/link'
import type { PublicFirmSite } from '@exsto/legal'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/lib/i18n'
import { darkenHex, isHexColor, landingBrandVars } from '@/lib/brandColor'
import { Wavefield } from '@/components/Wavefield'
import { FirmMarkGlyph } from '@/components/FirmMarkGlyph'
import {
  ArrowRightIcon,
  Building2Icon,
  FileTextIcon,
  LockIcon,
  LogInIcon,
  MailIcon,
  PhoneIcon,
} from '@/components/icons'

// FIRM-LANDING-3 — the firm front door at {slug}.{base}/, rebuilt to the
// approved comp: warm cream shell with a generated wavefield, one glass card
// holding the firm mark + name + EN/ES toggle, and exactly three ways out —
// "Legal Services" → /book (the funnel's picker lists the offerings), "Client
// portal" → /portal/login, and the gold "Attorney sign in" pill → /login.
// Plug-and-play theming: every blue in the comp derives from the firm's ONE
// stored brand color (legal.public.firm_branding headerColor, same value the
// funnel and portal tint from), so a new tenant needs only a name + color.
// Gold and the navy ink are fixed product accents. Attorney-authored tagline /
// about / contact (FIRM-LANDING-2 fields) still render — below the cards, only
// when set — so an unstyled new firm looks exactly like the comp. The services
// grid moved off the landing on purpose: the Legal Services card IS the route
// to that list.
//
// Client component (language toggle is stateful) but fully SSR-rendered; the
// server page still resolves all data and passes the closed PublicFirmSite.

// The comp's Carolina blue. Landing-only default for firms with no brand color
// set — the product navy reads too heavy across a full decorative wavefield.
const DEFAULT_BRAND = '#4B9CD3'

// ---- Firm mark -------------------------------------------------------------
// The comp's scales crest (FirmMarkGlyph), brand-filled on a white tile — the
// plug-and-play mark for a firm that has uploaded no art of its own.
// FIRM-BRANDING-1: once a firm uploads a logo (Settings → Firm Details) it
// takes the crest's place here, the same as on every other firm surface.
// BRANDING-SECTION-1: an uploaded mark renders BARE — no tile, no plate, no
// background. The product does not decorate a firm's artwork.
function FirmMark({
  brand,
  logoDataUrl,
}: {
  brand: string
  logoDataUrl: string | null
}): React.JSX.Element {
  if (logoDataUrl) {
    return (
      <span className="fl-mark fl-mark-logo" aria-hidden>
        <img src={logoDataUrl} alt="" />
      </span>
    )
  }
  return (
    <span className="fl-mark" aria-hidden>
      <FirmMarkGlyph brand={brand} size={40} />
    </span>
  )
}

// ---- Nav cards -------------------------------------------------------------
// The comp's tile: one header row (icon · title · arrow-in-circle), body below.
function NavCard({
  href,
  icon,
  title,
  body,
}: {
  href: string
  icon: React.ReactNode
  title: string
  body: string
}): React.JSX.Element {
  return (
    <Link href={href} className="fl-tile">
      <span className="fl-tile-head">
        <span className="fl-tile-icon">{icon}</span>
        <span className="fl-tile-title">{title}</span>
        <span className="fl-tile-arrow">
          <ArrowRightIcon size={17} strokeWidth={2.2} />
        </span>
      </span>
      <span className="fl-tile-body">{body}</span>
    </Link>
  )
}

const CONTACT_ROW_STYLE = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.55rem',
} as const

export function FirmLandingPage({ site }: { site: PublicFirmSite }): React.JSX.Element {
  const { t } = useI18n()
  // Tenant theming (COMP-RESTYLE-1): --fl-brand is only set when the firm has
  // stored a brand color. Unset, every .fl-* rule's fallback IS the comp's
  // exact hex — so an unstyled firm renders the approved comp pixel-for-pixel,
  // and a themed firm derives its whole blue family from the one stored color.
  const hasBrand = isHexColor(site.headerColor)
  const brand = hasBrand ? (site.headerColor as string) : DEFAULT_BRAND
  // BRANDING-SECTION-1 — the deep companion is the firm's SECONDARY color when
  // they set one, else the darkened primary (COMP-RESTYLE-1's derivation).
  const brandDeep = isHexColor(site.secondaryColor) ? site.secondaryColor : darkenHex(brand, 0.28)
  const { contact } = site
  const hasContact = Boolean(contact.phone || contact.email || contact.address)
  return (
    <main
      className="fl-shell"
      style={landingBrandVars(hasBrand ? brand : null, site.secondaryColor)}
    >
      <Wavefield brand={brand} brandDeep={brandDeep} className="fl-waves" idSuffix="landing" />
      <div className="fl-halo" aria-hidden />

      <div className="fl-frame">
        <div className="fl-topnav">
          <Link href="/login" className="fl-attorney">
            <LogInIcon size={16} strokeWidth={1.8} />
            {t('landing.attorney')}
          </Link>
        </div>

        <section className="fl-card">
          <div className="fl-card-head">
            {/* COMP-RESTYLE-1 — a dark/unknown-tone uploaded logo renders as
                the comp's bare 52px wordmark, replacing the crest + name.
                Reversed (light-ink) artwork can't sit bare on the cream shell,
                so it keeps the FIRM-BRANDING-1 plated tile + name lockup. */}
            {/* COMP-RESTYLE-1 — an uploaded mark replaces the crest + name and
                renders at the comp's 52px wordmark size, bare, whatever its
                tone (BRANDING-SECTION-1: no plate for reversed artwork). */}
            {site.logoDataUrl ? (
              <div className="fl-brand-row">
                <img src={site.logoDataUrl} alt="" className="fl-logo" />
                <h1 className="sr-only">{site.firmName}</h1>
              </div>
            ) : (
              <div className="fl-brand-row">
                <FirmMark brand={brand} logoDataUrl={null} />
                <h1 className="fl-name">{site.firmName}</h1>
              </div>
            )}
            <LanguageToggle />
          </div>

          {site.tagline && <p className="fl-tagline">{site.tagline}</p>}

          <div className="fl-grid">
            <NavCard
              href="/book"
              icon={<FileTextIcon size={25} strokeWidth={1.7} />}
              title={t('landing.services_title')}
              body={t('landing.services_body')}
            />
            <NavCard
              href="/portal/login"
              icon={<LockIcon size={24} strokeWidth={1.7} />}
              title={t('landing.portal_title')}
              body={t('landing.portal_body')}
            />
          </div>

          {(site.about || hasContact) && (
            <div className="fl-sections">
              {site.about && (
                <div>
                  <h2 className="fl-section-title">{t('landing.about_title')}</h2>
                  {/* pre-line keeps the attorney's paragraph breaks without
                      allowing any markup — the value is plain text. */}
                  <p className="fl-section-body" style={{ whiteSpace: 'pre-line' }}>
                    {site.about}
                  </p>
                </div>
              )}
              {hasContact && (
                <div>
                  <h2 className="fl-section-title">{t('landing.contact_title')}</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {contact.phone && (
                      <span className="fl-section-body" style={CONTACT_ROW_STYLE}>
                        <PhoneIcon size={16} />
                        <a href={`tel:${contact.phone}`} className="fl-link">
                          {contact.phone}
                        </a>
                      </span>
                    )}
                    {contact.email && (
                      <span className="fl-section-body" style={CONTACT_ROW_STYLE}>
                        <MailIcon size={16} />
                        <a href={`mailto:${contact.email}`} className="fl-link">
                          {contact.email}
                        </a>
                      </span>
                    )}
                    {contact.address && (
                      <span
                        className="fl-section-body"
                        style={{ ...CONTACT_ROW_STYLE, whiteSpace: 'pre-line' }}
                      >
                        <Building2Icon size={16} />
                        {contact.address}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
