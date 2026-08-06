'use client'

import Link from 'next/link'
import type { PublicFirmSite } from '@exsto/legal'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/lib/i18n'
import { darkenHex, isHexColor } from '@/lib/brandColor'
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

// Fixed gold accent pair (matches the comp's pl-gold gradient).
const GOLD = '#E6C983'
const GOLD_DEEP = '#B98F3D'

// ---- Wavefield -------------------------------------------------------------
// Deterministic stand-in for the comp's precomputed field: ~40 layered
// polylines drifting toward the lower right, amplitude and spacing growing
// with depth, opacity rising to a mid-field peak then fading out. Every 6th
// row is gold; the rest take the brand gradient. Module-level: computed once.
interface WaveRow {
  d: string
  gold: boolean
  width: number
  opacity: number
}

function buildWaveRows(): WaveRow[] {
  const rows: WaveRow[] = []
  const N = 40
  const peak = 17
  const xs: number[] = []
  for (let x = -40; x <= 1480; x += 24) xs.push(x)
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1)
    const baseY = 118 + i * 12 + t * t * 230
    const amp = 26 + 205 * t
    const lam = 265 + 130 * t
    const pts = xs.map((x) => {
      const y =
        baseY +
        amp * Math.sin((x - 430 - 300 * t) / lam) +
        amp * 0.35 * Math.sin((x + 220 * t) / (lam * 0.53) + 1.7)
      return `${x} ${y.toFixed(1)}`
    })
    const opacity =
      i <= peak
        ? 0.16 + (0.35 - 0.16) * (i / peak)
        : 0.35 - (0.35 - 0.05) * ((i - peak) / (N - 1 - peak))
    rows.push({
      d: `M${pts.join(' L')}`,
      gold: i % 6 === 3,
      width: 0.8 + i * 0.042,
      opacity: Number(opacity.toFixed(3)),
    })
  }
  return rows
}

const WAVE_ROWS = buildWaveRows()

function Wavefield({ brand, brandDeep }: { brand: string; brandDeep: string }): React.JSX.Element {
  return (
    <svg
      className="fl-waves"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <defs>
        <linearGradient id="fl-w-brand" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={brand} />
          <stop offset="1" stopColor={brandDeep} />
        </linearGradient>
        <linearGradient id="fl-w-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={GOLD} />
          <stop offset="1" stopColor={GOLD_DEEP} />
        </linearGradient>
      </defs>
      <g fill="none" strokeLinecap="round">
        {WAVE_ROWS.map((r, i) => (
          <path
            key={i}
            d={r.d}
            stroke={r.gold ? 'url(#fl-w-gold)' : 'url(#fl-w-brand)'}
            strokeWidth={r.width}
            strokeOpacity={r.opacity}
          />
        ))}
      </g>
    </svg>
  )
}

// ---- Firm mark -------------------------------------------------------------
// The comp's scales-of-justice crest, brand-filled on a white tile. Serves as
// the plug-and-play logo until firms can upload their own art: the mark takes
// the tenant's color automatically.
function FirmMark({ brand }: { brand: string }): React.JSX.Element {
  return (
    <span className="fl-mark" aria-hidden>
      <svg
        width="40"
        height="40"
        viewBox="10 26 492 470"
        fill={brand}
        stroke="none"
        style={{ transform: 'scaleY(0.9)' }}
      >
        <path d="M256 26 C268 44 268 66 256 80 C244 66 244 44 256 26 Z" />
        <rect x="247" y="80" width="18" height="11" rx="3" />
        <circle cx="256" cy="126" r="9" />
        <path d="M243 150 h26 l-5 -24 h-16 z" />
        <path d="M247 150 L265 150 L269 420 L243 420 Z" />
        <ellipse cx="256" cy="292" rx="15" ry="6" />
        <ellipse cx="256" cy="356" rx="13" ry="5" />
        <path d="M236 418 h40 v14 h-40 z" />
        <ellipse cx="256" cy="446" rx="40" ry="10" />
        <path d="M212 452 h88 v13 q0 6 -8 6 h-72 q-8 0 -8 -6 z" />
        <ellipse cx="256" cy="486" rx="72" ry="15" />
        <g transform="rotate(-5 256 150)">
          <path
            d="M128 150 Q256 128 384 150"
            fill="none"
            stroke={brand}
            strokeWidth="14"
            strokeLinecap="round"
          />
          <path
            d="M128 150 c-17 -1 -24 -15 -12 -23 9 -6 19 1 15 11"
            fill="none"
            stroke={brand}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <path
            d="M384 150 c17 -1 24 -15 12 -23 -9 -6 -19 1 -15 11"
            fill="none"
            stroke={brand}
            strokeWidth="8"
            strokeLinecap="round"
          />
          <circle cx="128" cy="150" r="9" />
          <circle cx="384" cy="150" r="9" />
        </g>
        <path d="M128 152 L82 286 M128 152 L174 286" fill="none" stroke={brand} strokeWidth="4" />
        <path d="M384 152 L338 286 M384 152 L430 286" fill="none" stroke={brand} strokeWidth="4" />
        <path d="M66 284 Q128 296 190 284 Q172 338 128 342 Q84 338 66 284 Z" />
        <path d="M322 284 Q384 296 446 284 Q428 338 384 342 Q340 338 322 284 Z" />
      </svg>
    </span>
  )
}

// ---- Nav cards -------------------------------------------------------------
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
      <span className="fl-tile-icon">{icon}</span>
      <span className="fl-tile-text">
        <span className="fl-tile-titlerow">
          <span className="fl-tile-title">{title}</span>
          <ArrowRightIcon size={21} />
        </span>
        <span className="fl-tile-body">{body}</span>
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
  const { t } = useI18n()
  const brand = isHexColor(site.headerColor) ? site.headerColor : DEFAULT_BRAND
  const brandDeep = darkenHex(brand, 0.28)
  const { contact } = site
  const hasContact = Boolean(contact.phone || contact.email || contact.address)
  return (
    <main
      className="fl-shell"
      style={{ ['--fl-brand' as string]: brand, ['--fl-brand-deep' as string]: brandDeep }}
    >
      <Wavefield brand={brand} brandDeep={brandDeep} />
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
            <div className="fl-brand-row">
              <FirmMark brand={brand} />
              <h1 className="fl-name">{site.firmName}</h1>
            </div>
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
