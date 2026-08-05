import Link from 'next/link'
import type { PublicFirmSite, PublicSiteService } from '@exsto/legal'
import { BookTopbar } from '@/components/BookTopbar'
import {
  ArrowRightIcon,
  Building2Icon,
  FileTextIcon,
  LockIcon,
  MailIcon,
  PhoneIcon,
  SparklesIcon,
} from '@/components/icons'

// FIRM-LANDING-2 — the attorney-editable landing page a visitor sees at
// {slug}.{base}/. Content comes entirely from getPublicFirmSite (firm profile
// fields edited in Settings → Firm Details → Public page, plus the same
// bookable-services list the /book funnel offers). Server-renderable on
// purpose: no state, no fetches — the page that renders it resolves the data —
// and it reuses the booking funnel's bk-* classes plus the firm brand-color
// treatment (BookTopbar crest tint) so the public surfaces read as one.
// Optional sections render only when set: no tagline → the v0 generic line;
// no about/contact → the section is absent, never an empty shell.

// Same friendly-icon heuristic as the /book picker's ServiceIcon — the tiles
// should look identical to the funnel the click lands on.
function ServiceTileIcon({ serviceKey }: { serviceKey: string }): React.JSX.Element {
  if (serviceKey.includes('amendment')) return <FileTextIcon size={20} />
  if (
    serviceKey.includes('llc') ||
    serviceKey.includes('formation') ||
    serviceKey.includes('business')
  ) {
    return <Building2Icon size={20} />
  }
  return <SparklesIcon size={20} />
}

// bk-service-card is styled for <button>; as an anchor it only needs the
// underline suppressed — not worth a new CSS class (same note as landing v0).
const CARD_LINK_STYLE = { textDecoration: 'none' } as const

function ServiceCard({ service }: { service: PublicSiteService }): React.JSX.Element {
  // The funnel's picker presets via ?service=<serviceKey> (see /book's
  // presetServiceKey effect) — a stale key degrades gracefully there, falling
  // back to the picker.
  return (
    <Link
      href={`/book?service=${encodeURIComponent(service.serviceKey)}`}
      className="bk-service-card"
      style={CARD_LINK_STYLE}
    >
      <span className="bk-service-icon">
        <ServiceTileIcon serviceKey={service.serviceKey} />
      </span>
      <span className="bk-service-text">
        <span className="bk-service-title">{service.title}</span>
        {service.description && <span className="bk-service-desc">{service.description}</span>}
      </span>
      <span className="bk-chooser-cta" aria-hidden>
        <ArrowRightIcon size={16} />
      </span>
    </Link>
  )
}

const CONTACT_ROW_STYLE = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.55rem',
} as const

export function FirmLandingPage({ site }: { site: PublicFirmSite }): React.JSX.Element {
  const { contact } = site
  const hasContact = Boolean(contact.phone || contact.email || contact.address)
  return (
    <main className="bk-shell">
      <div className="bk-aurora" aria-hidden />
      <div className="bk-frame">
        <BookTopbar
          firmName={site.firmName}
          brandColor={site.headerColor}
          showLanguageToggle={false}
        />
        <section className="bk-card">
          <div className="bk-stage">
            <div className="bk-stage-head">
              <h1 className="bk-h1">{site.firmName}</h1>
              <p className="bk-sub">{site.tagline ?? 'Legal services, handled properly.'}</p>
            </div>

            <div className="bk-actions">
              <Link href="/book" className="bk-btn bk-btn-primary bk-btn-wide">
                Book a consultation
                <ArrowRightIcon size={18} />
              </Link>
            </div>

            <div className="bk-sections">
              {site.services.length > 0 && (
                <div className="bk-section">
                  <h2 className="bk-section-title">Our services</h2>
                  <div className="bk-service-grid">
                    {site.services.map((s) => (
                      <ServiceCard key={s.serviceKey} service={s} />
                    ))}
                  </div>
                </div>
              )}

              {site.about && (
                <div className="bk-section">
                  <h2 className="bk-section-title">About the firm</h2>
                  {/* pre-line keeps the attorney's paragraph breaks without
                      allowing any markup — the value is plain text. */}
                  <p className="bk-sub" style={{ whiteSpace: 'pre-line' }}>
                    {site.about}
                  </p>
                </div>
              )}

              {hasContact && (
                <div className="bk-section">
                  <h2 className="bk-section-title">Contact</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                    {contact.phone && (
                      <span className="bk-sub" style={CONTACT_ROW_STYLE}>
                        <PhoneIcon size={16} />
                        <a href={`tel:${contact.phone}`} className="bk-linklike">
                          {contact.phone}
                        </a>
                      </span>
                    )}
                    {contact.email && (
                      <span className="bk-sub" style={CONTACT_ROW_STYLE}>
                        <MailIcon size={16} />
                        <a href={`mailto:${contact.email}`} className="bk-linklike">
                          {contact.email}
                        </a>
                      </span>
                    )}
                    {contact.address && (
                      <span
                        className="bk-sub"
                        style={{ ...CONTACT_ROW_STYLE, whiteSpace: 'pre-line' }}
                      >
                        <Building2Icon size={16} />
                        {contact.address}
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="bk-section">
                <h2 className="bk-section-title">Already a client?</h2>
                <div className="bk-service-grid">
                  <Link href="/portal/login" className="bk-service-card" style={CARD_LINK_STYLE}>
                    <span className="bk-service-icon">
                      <LockIcon size={20} />
                    </span>
                    <span className="bk-service-text">
                      <span className="bk-service-title">Client portal</span>
                      <span className="bk-service-desc">
                        Sign in to view your matter, documents, and messages.
                      </span>
                    </span>
                    <span className="bk-chooser-cta" aria-hidden>
                      <ArrowRightIcon size={16} />
                    </span>
                  </Link>
                </div>
              </div>
            </div>

            <p className="bk-chooser-foot">
              <Link href="/login" className="bk-linklike">
                Attorney sign in
              </Link>
            </p>
          </div>
        </section>
      </div>
    </main>
  )
}
