'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { ChevronDown, ThumbsUp, ThumbsDown } from 'lucide-react'
import {
  ScaleIcon,
  BellIcon,
  LayoutGridIcon,
  FileTextIcon,
  DollarSignIcon,
  SignatureIcon,
  SparklesIcon,
  SettingsIcon,
} from '@/components/icons'
import { FeeConsentCard } from '@/components/FeeConsentCard'
import { LanguageToggle } from '@/components/LanguageToggle'
import { PortalSideNav, type PortalNavItem } from '@/components/PortalSideNav'
import { portalNavKinds, type PortalNavKind } from '@/lib/portalNav'
import { Tabs } from '@/components/Tabs'
import { useI18n } from '@/lib/i18n'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'
import { renderDocumentHtml } from '@/lib/documentHtml'
import { formatDate, formatDateTime, parseTimestamp } from '@/lib/datetime'

// LI PORTAL RESTYLE — the client portal reshaped to the Legal Instruments comp
// (docs/design/legal-instruments/legal-instruments.dc.html, Client Portal
// section). Navy header + light content; PT-1 (founder walk 15.11) replaced the
// comp's horizontal tab band with the platform's SIDE navigation (Home ·
// Documents · Invoices · Signatures · Assistant · Settings) — PortalSideNav.tsx
// ports the attorney rail's mechanics and li-rail-* chrome. A notifications
// bell lives in the header (the comp has no notif tab, but #344 shipped it, so it
// survives as a bell, wearing the attorney top-bar's li-top-bell treatment).
// Every capability from CLIENT-PORTAL-UI-1 / PORTAL-1 / #384 is preserved —
// this is a restyle + reshape, not a removal. Copy goes through the i18n layer
// (client-copy doctrine: no internal step names or attorney verbiage).
// CSS families: li-cp-* + li-cpnav-* (globals.css tail).

interface MeFirm {
  tenantId: string
  firmName: string
  slug: string | null
  current: boolean
  main: boolean
}
interface MeResponse {
  email: string
  displayName: string
  matterCount: number
  // MULTI-FIRM (referrals-tenancy P1): the CURRENT firm's name (header brand)
  // and the person's firm memberships (firms[0] = main firm) for the switcher.
  firmName: string | null
  firms: MeFirm[]
}

// The current firm's display name, provided by the page shell once /me loads —
// child views label the attorney side of message threads with it instead of a
// hardcoded firm name.
const FirmNameContext = createContext<string>('')
function useFirmName(): string {
  return useContext(FirmNameContext) || 'Your firm'
}
function firmInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'F'
  )
}
interface MatterListItem {
  matterEntityId: string
  matterNumber: string
  statusKey: string
  statusLabel: string
  statusChip: 'in_progress' | 'completed'
  serviceLabel: string | null
  openedAt: string
  archived: boolean
}
interface Milestone {
  key: string
  label: string
  occurredAt: string
}
interface Timeline {
  matterNumber: string
  statusKey: string
  statusLabel: string
  statusChip: 'in_progress' | 'completed'
  serviceLabel?: string | null
  scheduledAt: string | null
  canManageEvent: boolean
  manageUrl: string | null
  milestones: Milestone[]
}
interface ClientDocument {
  requestId: string
  envelopeId: string
  documentTitle: string | null
  matterEntityId: string | null
  matterNumber: string | null
  state: 'awaiting_you' | 'signed' | 'declined' | 'in_progress'
  rawStatus: string
}
interface ApprovedDocument {
  documentVersionId: string
  documentKind: string
  matterEntityId: string
  matterNumber: string
  versionNumber: number
  approvedAt: string
}
interface UploadedDocument {
  documentVersionId: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  matterEntityId: string
  matterNumber: string
  uploadedAt: string
  /** S1: false when the recorded object no longer resolves to bytes in storage. */
  available: boolean
}
interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}
interface ClientInvoice {
  invoiceEntityId: string
  invoiceNumber: string
  status: 'due' | 'paid'
  total: string
  currency: string
  issuedDate: string | null
  dueDate: string | null
}
type RequestType = 'meeting' | 'document' | 'review'
interface RequestQuote {
  requestType: RequestType
  amount: string
  currency: string
  basis: string
  durationMinutes: number | null
  label: string
}
interface ClientRequest {
  requestEntityId: string
  requestType: string
  status: string
  description: string
  amount: string
  currency: string
  priceBasis: string
  createdAt: string
}

interface HomeSummary {
  firstName: string | null
  matters: MatterListItem[]
  attention: Array<
    | {
        kind: 'consultation'
        matterEntityId: string
        matterNumber: string
        scheduledAt: string
        scheduledEnd: string | null
        manageUrl: string | null
      }
    | {
        kind: 'signature'
        requestId: string
        documentTitle: string | null
        matterNumber: string | null
      }
  >
  messagesPreview: Array<{
    matterEntityId: string
    author: 'client' | 'attorney'
    body: string
    sentAt: string
  }>
  billing: { dueTotal: string; dueCount: number; nextDueDate: string | null; currency: string }
  unreadCount: number
  engagement: {
    accepted: boolean
    acceptedAt: string | null
    rate: string | null
    termsVersion: number | null
    configured: boolean
    hasSignedAgreement: boolean
  }
  assistantEnabled: boolean
}

interface NotificationItem {
  id: string
  type:
    | 'message'
    | 'document'
    | 'esign_request'
    | 'invoice'
    | 'booking_confirmed'
    | 'booking_changed'
    | 'booking_cancelled'
  occurredAt: string
  matterEntityId: string | null
  matterNumber: string | null
  matterLabel: string | null
  ref: string | null
  unread: boolean
}

// PT-1: the section-kind union lives in lib/portalNav (pure, unit-tested
// Assistant gating); the old horizontal tab band is now the side rail.
type TabKind = PortalNavKind
type View =
  | { kind: TabKind }
  | { kind: 'notifications' }
  | { kind: 'schedule' }
  | { kind: 'matter'; matterEntityId: string }

// Icon + i18n metadata per nav section (labels resolve through t() at render).
const NAV_META: Record<
  TabKind,
  { key: string; fallback: string; Icon: (p: { size?: number }) => React.JSX.Element }
> = {
  home: { key: 'portal.nav.home', fallback: 'Home', Icon: LayoutGridIcon },
  documents: { key: 'portal.nav.documents', fallback: 'Documents', Icon: FileTextIcon },
  invoices: { key: 'portal.nav.invoices', fallback: 'Invoices', Icon: DollarSignIcon },
  signatures: { key: 'portal.nav.signatures', fallback: 'Signatures', Icon: SignatureIcon },
  assistant: { key: 'portal.nav.assistant', fallback: 'Assistant', Icon: SparklesIcon },
  settings: { key: 'portal.nav.settings', fallback: 'Settings', Icon: SettingsIcon },
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function formatBytes(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount)
  if (!Number.isFinite(n)) return `${amount} ${currency}`
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n)
  } catch {
    return `${amount} ${currency}`
  }
}

// MM/YYYY for the matter row (founder-decided row format).
function formatOpened(openedAt: string): string {
  const d = parseTimestamp(openedAt)
  if (!d) return ''
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

export default function ClientPortalPage() {
  const { t, lang } = useI18n()
  const [me, setMe] = useState<MeResponse | null>(null)
  const [home, setHome] = useState<HomeSummary | null>(null)
  const [view, setView] = useState<View>({ kind: 'home' })
  const [error, setError] = useState<string | null>(null)
  const [gateOpen, setGateOpen] = useState(false)
  const [badge, setBadge] = useState<number>(0)

  useEffect(() => {
    fetch('/api/client/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/portal/login'
          return null
        }
        return res.json()
      })
      .then((body: MeResponse | null) => body && setMe(body))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  const loadHome = useCallback(() => {
    callClientPortalMcp<{ home: HomeSummary }>({
      toolName: 'legal.client.home_summary',
      input: { locale: lang },
    })
      .then((r) => {
        setHome(r.home)
        setBadge(r.home.unreadCount)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [lang])

  useEffect(() => {
    if (me) loadHome()
  }, [me, loadHome])

  const locked = home ? !home.engagement.accepted : false
  const assistantEnabled = home?.assistantEnabled ?? false

  // The six comp sections, now side-nav items. Assistant only appears for
  // clients whose firm enabled it (WP-7) — no empty/dead item; the gating rule
  // itself lives in lib/portalNav (unit-tested).
  const navItems: PortalNavItem[] = portalNavKinds({ assistantEnabled }).map((kind) => ({
    kind,
    label: t(NAV_META[kind].key, undefined, NAV_META[kind].fallback),
    Icon: NAV_META[kind].Icon,
  }))

  return (
    <FirmNameContext.Provider value={me?.firmName ?? ''}>
      <div className="li-cp-shell li-cpnav-shell">
        <PortalSideNav
          items={navItems}
          active={view.kind}
          onSelect={(kind) => setView({ kind })}
          user={me ? { displayName: me.displayName, email: me.email } : null}
        />
        <div className="li-cpnav-col">
          <header className="li-cpnav-header">
            <div className="li-cp-top">
              <div className="li-cp-top-inner">
                <button
                  type="button"
                  className="li-cp-brand"
                  onClick={() => setView({ kind: 'home' })}
                  aria-label={t('portal.nav.home', undefined, 'Home')}
                >
                  <span className="li-cp-brand-crest" aria-hidden>
                    <ScaleIcon size={24} />
                  </span>
                  <span className="li-cp-brand-text">
                    <span className="li-cp-brand-name">{me?.firmName ?? ' '}</span>
                    <span className="li-cp-brand-sub">
                      {t('portal.brand_sub', undefined, 'Client Portal')}
                    </span>
                  </span>
                </button>
                {me && me.firms.length > 1 && <FirmSwitcher firms={me.firms} />}
                <div className="li-cp-top-right">
                  <div className="li-cp-lang">
                    <LanguageToggle />
                  </div>
                  {/* PT-1: the attorney top-bar bell treatment (li-top-bell +
                    gold unread dot) replaces the old rounded-square button with
                    the floating count badge; the count moves into the
                    label/tooltip. */}
                  <button
                    type="button"
                    className={`li-top-bell li-cpnav-bell${
                      view.kind === 'notifications' ? ' active' : ''
                    }`}
                    aria-label={
                      badge > 0
                        ? `${t('portal.nav.notifications', undefined, 'Notifications')} (${badge})`
                        : t('portal.nav.notifications', undefined, 'Notifications')
                    }
                    title={
                      badge > 0
                        ? `${t('portal.nav.notifications', undefined, 'Notifications')} (${badge})`
                        : t('portal.nav.notifications', undefined, 'Notifications')
                    }
                    onClick={() => setView({ kind: 'notifications' })}
                  >
                    <BellIcon size={19} />
                    {badge > 0 && <span className="li-top-bell-dot" aria-hidden="true" />}
                  </button>
                </div>
              </div>
            </div>
          </header>

          <div className="li-cpnav-scroll">
            <main className="li-cp-main">
              {error && (
                <div className="alert alert-error" role="alert">
                  {error}
                </div>
              )}

              {!me || !home ? (
                <div className="loading-block" role="status">
                  <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
                </div>
              ) : (
                <>
                  {view.kind === 'home' && (
                    <HomeView
                      home={home}
                      locked={locked}
                      onOpenMatter={(id) => setView({ kind: 'matter', matterEntityId: id })}
                      onOpenInvoices={() => setView({ kind: 'invoices' })}
                      onOpenSchedule={() => setView({ kind: 'schedule' })}
                      onOpenGate={() => setGateOpen(true)}
                    />
                  )}
                  {view.kind === 'documents' && <DocumentsView matters={home.matters} />}
                  {view.kind === 'invoices' && <InvoicesView />}
                  {view.kind === 'signatures' && <SignaturesView />}
                  {view.kind === 'assistant' && assistantEnabled && <AssistantView />}
                  {view.kind === 'settings' && <SettingsView me={me} />}
                  {view.kind === 'notifications' && (
                    <NotificationsView
                      onBadge={setBadge}
                      onOpenMatter={(id) => setView({ kind: 'matter', matterEntityId: id })}
                      onOpenInvoices={() => setView({ kind: 'invoices' })}
                      onOpenSignatures={() => setView({ kind: 'signatures' })}
                    />
                  )}
                  {view.kind === 'schedule' && (
                    <>
                      <BackHome onBack={() => setView({ kind: 'home' })} />
                      <ScheduleView />
                    </>
                  )}
                  {view.kind === 'matter' && (
                    <MatterView
                      matterEntityId={view.matterEntityId}
                      matters={home.matters}
                      locked={locked}
                      onBack={() => setView({ kind: 'home' })}
                      onOpenGate={() => setGateOpen(true)}
                    />
                  )}
                </>
              )}
            </main>
          </div>
        </div>

        {gateOpen && home && (
          <EngagementGateModal
            rate={home.engagement.rate}
            configured={home.engagement.configured}
            onClose={() => setGateOpen(false)}
            onAccepted={() => {
              setGateOpen(false)
              loadHome()
            }}
          />
        )}
      </div>
    </FirmNameContext.Provider>
  )
}

// MULTI-FIRM (referrals-tenancy P1): compact header dropdown listing every firm
// this person is a client of. Picking one POSTs /api/client/auth/switch-firm
// (server re-proves membership, re-mints the single-tenant session) and reloads.
function FirmSwitcher({ firms }: { firms: MeFirm[] }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [switching, setSwitching] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  async function pick(firm: MeFirm) {
    if (firm.current || switching) {
      setOpen(false)
      return
    }
    setSwitching(true)
    try {
      const res = await fetch('/api/client/auth/switch-firm', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tenantId: firm.tenantId }),
      })
      if (!res.ok) throw new Error('switch failed')
      window.location.assign('/portal')
    } catch {
      setSwitching(false)
      setOpen(false)
    }
  }

  return (
    <div className="li-cp-firmswitch" ref={wrapRef}>
      <button
        type="button"
        className="li-cp-firmswitch-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        disabled={switching}
      >
        {t('portal.firm_switch', undefined, 'Switch firm')}
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="li-cp-firmswitch-menu" role="listbox" aria-label="Your firms">
          {firms.map((f) => (
            <button
              key={f.tenantId}
              type="button"
              role="option"
              aria-selected={f.current}
              className={`li-cp-firmswitch-item ${f.current ? 'current' : ''}`}
              onClick={() => pick(f)}
            >
              <span className="li-cp-firmswitch-name">{f.firmName}</span>
              {f.main && (
                <span className="li-cp-firmswitch-tag">
                  {t('portal.firm_main', undefined, 'Main')}
                </span>
              )}
              {f.current && (
                <span className="li-cp-firmswitch-check" aria-hidden>
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BackHome({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="li-cp-back" onClick={onBack}>
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <polyline points="15 18 9 12 15 6" />
      </svg>
      {t('portal.back_home', undefined, 'Back to home')}
    </button>
  )
}

// Small inline icons reused across the portal views.
function SigIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
function CalIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}
function ChevRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  )
}

// ── Home ─────────────────────────────────────────────────────────────────────

function HomeView({
  home,
  locked,
  onOpenMatter,
  onOpenInvoices,
  onOpenSchedule,
  onOpenGate,
}: {
  home: HomeSummary
  locked: boolean
  onOpenMatter: (id: string) => void
  onOpenInvoices: () => void
  onOpenSchedule: () => void
  onOpenGate: () => void
}) {
  const { t } = useI18n()
  const firmName = useFirmName()
  const hour = new Date().getHours()
  const greetKey =
    hour < 12
      ? 'portal.greeting.morning'
      : hour < 18
        ? 'portal.greeting.afternoon'
        : 'portal.greeting.evening'
  const name = home.firstName ? `, ${home.firstName}` : ''

  // A matter needing the client's signature shows the warn chip; a matter with
  // an upcoming consultation the ok chip. Internal state keys never render.
  const signatureMatters = new Set(
    home.attention
      .filter((a) => a.kind === 'signature')
      .map((a) => (a.kind === 'signature' ? a.matterNumber : null))
      .filter(Boolean),
  )
  const consultationMatters = new Set(
    home.attention.filter((a) => a.kind === 'consultation').map((a) => a.matterNumber),
  )

  return (
    <>
      <h1 className="li-cp-h1">{t(greetKey, { name }, `Good afternoon${name}.`)}</h1>

      {locked && (
        <section className="li-cp-card li-cp-gate">
          <div className="li-cp-gate-lock" aria-hidden>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div className="li-cp-gate-txt">
            <h3>{t('portal.gate.title')}</h3>
            <p>{t('portal.gate.body')}</p>
            {home.engagement.rate && (
              <div className="li-cp-gate-rate">
                {t('portal.gate.rate', { rate: home.engagement.rate })}
              </div>
            )}
          </div>
          <button type="button" className="li-cp-btn" onClick={onOpenGate}>
            {t('portal.gate.cta')}
          </button>
        </section>
      )}

      {!locked && home.engagement.hasSignedAgreement && (
        <a
          className="li-cp-signed-agreement"
          href="/api/client/portal/engagement/agreement"
          target="_blank"
          rel="noopener noreferrer"
        >
          <SigIcon />
          <span>
            {t('portal.agreement.download', undefined, 'View your signed engagement agreement')}
          </span>
        </a>
      )}

      {home.attention.length > 0 && (
        <div className="li-cp-attn" aria-label={t('portal.attention.label')}>
          {home.attention.map((item, i) =>
            item.kind === 'consultation' ? (
              <div className="li-cp-attn-row li-cp-attn-row--ok" key={`c-${i}`}>
                <span className="li-cp-attn-ico li-cp-attn-ico--ok" aria-hidden>
                  <CalIcon />
                </span>
                <div className="li-cp-attn-txt">
                  <div className="li-cp-attn-k li-cp-attn-k--ok">
                    {t('portal.attention.consultation')}
                  </div>
                  <div className="li-cp-attn-v">
                    {parseTimestamp(item.scheduledAt)?.toLocaleString(undefined, {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    })}
                  </div>
                  <div className="li-cp-attn-m">{item.matterNumber}</div>
                </div>
                {item.manageUrl && (
                  <a className="li-cp-btn" href={item.manageUrl}>
                    {t('portal.attention.manage')}
                  </a>
                )}
              </div>
            ) : (
              <div className="li-cp-attn-row li-cp-attn-row--warn" key={`s-${i}`}>
                <span className="li-cp-attn-ico li-cp-attn-ico--warn" aria-hidden>
                  <SigIcon />
                </span>
                <div className="li-cp-attn-txt">
                  <div className="li-cp-attn-k li-cp-attn-k--warn">
                    {t('portal.attention.signature')}
                  </div>
                  <div className="li-cp-attn-v">{item.documentTitle ?? t('portal.docs.title')}</div>
                  {item.matterNumber && <div className="li-cp-attn-m">{item.matterNumber}</div>}
                </div>
                <a className="li-cp-btn" href={`/portal/sign/${item.requestId}`}>
                  {t('portal.attention.sign')}
                </a>
              </div>
            ),
          )}
        </div>
      )}

      <section className="li-cp-block">
        <div className="li-cp-section-label">{t('portal.matters.label')}</div>
        {home.matters.length === 0 ? (
          <div className="li-cp-card li-cp-empty">{t('portal.matters.empty')}</div>
        ) : (
          <div className="li-cp-card li-cp-matters">
            {home.matters.map((m) => {
              const variant =
                m.statusChip === 'completed'
                  ? 'neutral'
                  : signatureMatters.has(m.matterNumber)
                    ? 'warn'
                    : consultationMatters.has(m.matterNumber)
                      ? 'ok'
                      : 'info'
              return (
                <button
                  type="button"
                  key={m.matterEntityId}
                  className="li-cp-matter"
                  onClick={() => onOpenMatter(m.matterEntityId)}
                >
                  <span className="li-cp-matter-main">
                    <span className="li-cp-matter-title">
                      {m.serviceLabel ?? t('portal.matter.generic')}
                    </span>
                    <span className="li-cp-matter-meta">
                      {formatOpened(m.openedAt)} · {m.matterNumber}
                    </span>
                  </span>
                  <StatusChip variant={variant} label={t(`portal.matter.status.${m.statusChip}`)} />
                  <span className="li-cp-chev" aria-hidden>
                    <ChevRight />
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </section>

      <div className="li-cp-grid3">
        <div className="li-cp-tile">
          <h3 className="li-cp-tile-h3">{t('portal.rail.book.title')}</h3>
          <p className="li-cp-tile-p">{t('portal.rail.book.body')}</p>
          <button
            type="button"
            className="li-cp-btn li-cp-btn--block"
            onClick={onOpenSchedule}
            disabled={locked}
          >
            {t('portal.rail.book.cta')}
          </button>
        </div>

        <div
          className="li-cp-tile"
          style={locked ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
        >
          <h3 className="li-cp-tile-h3">{t('portal.messages.label')}</h3>
          {home.messagesPreview.length === 0 ? (
            <p className="li-cp-tile-p">{t('portal.messages.empty')}</p>
          ) : (
            <div className="li-cp-msglist">
              {home.messagesPreview.map((msg, i) => (
                <button
                  type="button"
                  key={i}
                  className="li-cp-msg"
                  onClick={() => onOpenMatter(msg.matterEntityId)}
                >
                  <span className="li-cp-msg-av" aria-hidden>
                    {msg.author === 'attorney'
                      ? firmInitials(firmName)
                      : t('portal.messages.you').slice(0, 2)}
                  </span>
                  <span className="li-cp-msg-body">
                    <span className="li-cp-msg-from">
                      {msg.author === 'attorney' ? firmName : t('portal.messages.you')}
                    </span>
                    <span className="li-cp-msg-snip">
                      {msg.body.length > 90 ? `${msg.body.slice(0, 90)}…` : msg.body}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="li-cp-tile">
          <h3 className="li-cp-tile-h3">{t('portal.billing.label')}</h3>
          {home.billing.dueCount === 0 ? (
            <p className="li-cp-tile-p">{t('portal.billing.clear')}</p>
          ) : (
            <>
              <div className="li-cp-amt">
                {formatMoney(home.billing.dueTotal, home.billing.currency)}
              </div>
              <div className="li-cp-amt-sub">
                {t(
                  home.billing.dueCount === 1
                    ? 'portal.billing.due_one'
                    : 'portal.billing.due_many',
                  {
                    count: home.billing.dueCount,
                    date: home.billing.nextDueDate
                      ? ` · ${formatDate(home.billing.nextDueDate)}`
                      : '',
                  },
                )}
              </div>
              <button
                type="button"
                className="li-cp-btn li-cp-btn--gold li-cp-btn--block"
                onClick={onOpenInvoices}
              >
                {t('portal.billing.cta')}
              </button>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function StatusChip({ variant, label }: { variant: string; label: string }) {
  return (
    <span className={`li-cp-chip li-cp-chip--${variant}`}>
      <span className="li-cp-chip-dot" aria-hidden />
      {label}
    </span>
  )
}

// ── Engagement gate (WP-6) — mounts the ONE FeeConsentCard ──────────────────

function EngagementGateModal({
  rate,
  configured,
  onClose,
  onAccepted,
}: {
  rate: string | null
  configured: boolean
  onClose: () => void
  onAccepted: () => void
}) {
  const { t } = useI18n()
  const [terms, setTerms] = useState<string | null>(null)
  // ENGAGEMENT-DOC-1 — when the firm has uploaded its real engagement letter,
  // the gate shows the FULL merged agreement and the typed name below is the
  // client's electronic signature (required server-side). The text terms +
  // fee-consent checkbox stay alongside (founder decision: both).
  const [agreement, setAgreement] = useState<{ markdown: string } | null>(null)
  const [signedName, setSignedName] = useState('')
  // Two consents in ONE modal (combined per founder request): `accepted` is the
  // hourly-rate/fee acceptance (the FeeConsentCard, shown in both flows);
  // `agreeChecked` is the "I have read and agree + adopt my signature" adoption of
  // the uploaded agreement document (only when there is one).
  const [accepted, setAccepted] = useState(false)
  const [agreeChecked, setAgreeChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canConfirm = agreement ? Boolean(signedName.trim()) && agreeChecked && accepted : accepted

  useEffect(() => {
    callClientPortalMcp<{
      status: { accepted: boolean }
      config: { rate: string | null; termsText: string | null; configured: boolean }
      agreement: { markdown: string } | null
    }>({ toolName: 'legal.client.engagement' })
      .then((r) => {
        setTerms(r.config.termsText)
        setAgreement(r.agreement ?? null)
      })
      .catch(() => setTerms(null))
  }, [])

  async function confirm() {
    if (!canConfirm || busy) return
    setBusy(true)
    setError(null)
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.engagement_accept',
        input: agreement ? { signedName: signedName.trim() } : {},
      })
      onAccepted()
    } catch (e) {
      if (!(e instanceof PortalSessionExpiredError)) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="li-cp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('portal.gate.terms_title')}
      onClick={onClose}
    >
      <div className="li-cp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="li-cp-modal-head">
          <h2 className="li-cp-modal-title">{t('portal.gate.terms_title')}</h2>
          <button
            type="button"
            className="li-cp-modal-x"
            aria-label={t('portal.gate.cancel')}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="li-cp-modal-body">
          {!configured ? (
            <p className="li-cp-muted">{t('portal.gate.unavailable')}</p>
          ) : (
            <>
              {/* One modal (fee + agreement combined). When the firm uploaded its
                  engagement letter, the client reviews the real rendered document,
                  types their signature, and gives both consents here: adopting the
                  agreement AND accepting the hourly rate. */}
              {agreement ? (
                <>
                  <div className="li-cp-agreement-frame">
                    <article
                      className="doc-rendered doc-paper li-cp-agreement-paper"
                      dangerouslySetInnerHTML={{ __html: renderDocumentHtml(agreement.markdown) }}
                    />
                  </div>
                  <label className="li-cp-sign-row">
                    <span>
                      {t('portal.gate.sign_label', undefined, 'Sign by typing your full name')}
                    </span>
                    <input
                      className="li-cp-sign-input"
                      value={signedName}
                      onChange={(e) => setSignedName(e.target.value)}
                      placeholder={t('portal.gate.sign_placeholder', undefined, 'Your full name')}
                      autoComplete="name"
                    />
                  </label>
                  <label className="bk-checkbox bk-fee-accept">
                    <input
                      type="checkbox"
                      checked={agreeChecked}
                      onChange={(e) => setAgreeChecked(e.target.checked)}
                    />
                    <span>
                      {t(
                        'portal.gate.agree_agreement',
                        undefined,
                        'I have read and agree to this engagement agreement, and adopt the signature above.',
                      )}
                    </span>
                  </label>
                </>
              ) : (
                terms && <div className="li-cp-terms">{terms}</div>
              )}
              {/* The hourly-rate acceptance — an additional checkbox in the same
                  modal (was a separate fee dialog before). */}
              <FeeConsentCard
                quote={{
                  basis: 'hourly-rate',
                  amount: null,
                  rate,
                  currency: 'USD',
                  description: t('portal.gate.desc'),
                }}
                accepted={accepted}
                onAccept={setAccepted}
                t={t}
              />
            </>
          )}
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="li-cp-modal-foot">
          <button
            type="button"
            className="li-cp-btn li-cp-btn--ghost"
            onClick={onClose}
            disabled={busy}
          >
            {t('portal.gate.cancel')}
          </button>
          {configured && (
            <button
              type="button"
              className="li-cp-btn"
              disabled={!canConfirm || busy}
              onClick={confirm}
            >
              {busy ? '…' : t('portal.gate.confirm')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CloseIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

// ── Notifications (WP-3) ─────────────────────────────────────────────────────

function NotificationsView({
  onBadge,
  onOpenMatter,
  onOpenInvoices,
  onOpenSignatures,
}: {
  onBadge: (n: number) => void
  onOpenMatter: (id: string) => void
  onOpenInvoices: () => void
  onOpenSignatures: () => void
}) {
  const { t } = useI18n()
  const [items, setItems] = useState<NotificationItem[] | null>(null)

  useEffect(() => {
    let cancelled = false
    callClientPortalMcp<{ feed: { items: NotificationItem[]; unreadCount: number } }>({
      toolName: 'legal.client.notifications',
    })
      .then((r) => {
        if (cancelled) return
        setItems(r.feed.items)
        // Opening the feed marks it read — an APPEND-ONLY watermark action.
        if (r.feed.unreadCount > 0) {
          callClientPortalMcp({ toolName: 'legal.client.notifications_read' })
            .then(() => onBadge(0))
            .catch(() => {})
        } else {
          onBadge(0)
        }
      })
      .catch((e) => {
        if (!(e instanceof PortalSessionExpiredError)) setItems([])
      })
    return () => {
      cancelled = true
    }
  }, [onBadge])

  function open(item: NotificationItem) {
    if (item.type === 'invoice' && item.ref) {
      window.location.href = `/portal/pay/${encodeURIComponent(item.ref)}`
      return
    }
    if (item.type === 'document' && item.ref) {
      window.open(`/d/${item.ref}`, '_blank', 'noopener')
      return
    }
    if (item.type === 'esign_request') {
      onOpenSignatures()
      return
    }
    if (item.matterEntityId) {
      onOpenMatter(item.matterEntityId)
      return
    }
    if (item.type === 'invoice') onOpenInvoices()
  }

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.notif.title')}</h1>
      <section className="li-cp-card li-cp-list">
        {items === null ? (
          <div className="loading-block" role="status">
            <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
          </div>
        ) : items.length === 0 ? (
          <div className="li-cp-empty-row">{t('portal.notif.empty')}</div>
        ) : (
          items.map((item) => (
            <button type="button" key={item.id} className="li-cp-notif" onClick={() => open(item)}>
              {item.unread && <span className="li-cp-notif-dot" aria-hidden />}
              <span className="li-cp-notif-body">
                <span className="li-cp-notif-label">
                  {t(`portal.notif.${item.type}`, { ref: item.ref ?? '' })}
                </span>
                <span className="li-cp-notif-meta">
                  {item.matterLabel ? `${item.matterLabel} · ` : ''}
                  {formatDateTime(item.occurredAt)}
                </span>
              </span>
              <span className="li-cp-chev" aria-hidden>
                <ChevRight />
              </span>
            </button>
          ))
        )}
      </section>
    </>
  )
}

// ── Documents — flat cross-matter list, From attorney / You uploaded (comp) ──

const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt'
const INLINE_VIEW_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])

type DocTag = { label: string; variant: string }
function approvedTag(kind: string): DocTag {
  const k = kind.toLowerCase()
  if (k.includes('agreement')) return { label: 'Agreement', variant: 'purple' }
  if (k.includes('memo')) return { label: 'Memo', variant: 'info' }
  return { label: 'Letter', variant: 'info' }
}

// A unified row model so From-attorney (approved + e-sign) and You-uploaded rows
// render through one comp row. `kind` drives the file-type icon.
interface DocRowModel {
  key: string
  name: string
  tag: DocTag
  matterLabel: string
  date: string | null
  icon: 'word' | 'pdf'
  actions: Array<{ label: string; href?: string; download?: string; external?: boolean }>
}

function DocFileIcon({ icon }: { icon: 'word' | 'pdf' }) {
  if (icon === 'pdf') {
    return (
      <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
          fill="#FBECEA"
          stroke="#C4443B"
          strokeWidth="1.3"
        />
        <path d="M14 3v5h5" stroke="#C4443B" strokeWidth="1.3" fill="none" />
        <text
          x="12"
          y="18"
          fontSize="5.4"
          fontFamily="Public Sans"
          fontWeight="800"
          fill="#C4443B"
          textAnchor="middle"
        >
          PDF
        </text>
      </svg>
    )
  }
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 3h9l5 5v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"
        fill="#EAF0FB"
        stroke="#2B579A"
        strokeWidth="1.3"
      />
      <path d="M14 3v5h5" stroke="#2B579A" strokeWidth="1.3" fill="none" />
      <text
        x="12"
        y="18"
        fontSize="6.5"
        fontFamily="Public Sans"
        fontWeight="800"
        fill="#2B579A"
        textAnchor="middle"
      >
        W
      </text>
    </svg>
  )
}

function DocRow({ row }: { row: DocRowModel }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  return (
    <div className="li-cp-doc-row">
      <span className="li-cp-doc-icon">
        <DocFileIcon icon={row.icon} />
      </span>
      <div className="li-cp-doc-main">
        <span className="li-cp-doc-name">{row.name}</span>
        <span className={`li-cp-doc-tag li-cp-doc-tag--${row.tag.variant}`}>{row.tag.label}</span>
      </div>
      <span className="li-cp-doc-matter">{row.matterLabel}</span>
      <span className="li-cp-doc-date">{row.date ?? ''}</span>
      <div className="li-cp-doc-actions" ref={wrapRef}>
        <button
          type="button"
          className="li-cp-doc-kebab"
          aria-label="Actions"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <circle cx="12" cy="5" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="12" cy="19" r="1.7" />
          </svg>
        </button>
        {menuOpen && (
          <div className="li-cp-doc-menu" role="menu">
            {row.actions.map((a, i) => (
              <a
                key={i}
                className="li-cp-doc-menu-item"
                href={a.href}
                download={a.download}
                target={a.external ? '_blank' : undefined}
                rel={a.external ? 'noopener noreferrer' : undefined}
                role="menuitem"
                onClick={() => setMenuOpen(false)}
              >
                {a.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function DocumentsView({ matters }: { matters: MatterListItem[] }) {
  const { t } = useI18n()
  const [esign, setEsign] = useState<ClientDocument[] | null>(null)
  const [approved, setApproved] = useState<ApprovedDocument[] | null>(null)
  const [uploads, setUploads] = useState<UploadedDocument[] | null>(null)
  const [tab, setTab] = useState<'attorney' | 'uploaded'>('attorney')
  const [search, setSearch] = useState('')
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const loadUploads = useCallback(() => {
    // S1: fetch from the app route that annotates each upload with `available`
    // (object-existence). legal.client.uploads deliberately omits the object key,
    // so availability is resolved server-side in the app layer, not the browser.
    fetch('/api/client/portal/uploads', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : { documents: [] }))
      .then((r: { documents: UploadedDocument[] }) => setUploads(r.documents))
      .catch(() => setUploads([]))
  }, [])

  useEffect(() => {
    callClientPortalMcp<{ documents: ClientDocument[] }>({
      toolName: 'legal.esign.portal.documents',
    })
      .then((r) => setEsign(r.documents))
      .catch(() => setEsign([]))
    callClientPortalMcp<{ documents: ApprovedDocument[] }>({ toolName: 'legal.client.documents' })
      .then((r) => setApproved(r.documents))
      .catch(() => setApproved([]))
    loadUploads()
  }, [loadUploads])

  async function onFile(matterEntityId: string, file: File) {
    setUploadingFor(matterEntityId)
    setUploadErr(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/client/portal/matters/${matterEntityId}/documents/upload`, {
        method: 'POST',
        credentials: 'same-origin',
        body: fd,
      })
      if (res.status === 401) {
        window.location.href = '/portal/login'
        return
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) throw new Error(data?.error ?? 'Upload failed.')
      loadUploads()
      setTab('uploaded')
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingFor(null)
    }
  }

  const loading = esign === null || approved === null || uploads === null
  const matterLabel = (num: string | null, id: string | null) => {
    const m = matters.find((mm) => mm.matterNumber === num || mm.matterEntityId === id)
    return m?.matterNumber ?? num ?? ''
  }
  const q = search.trim().toLowerCase()
  const match = (s: string | null | undefined) => !q || (s ?? '').toLowerCase().includes(q)

  // From attorney = approved letters + e-sign envelopes (tagged). Data stays
  // matter-scoped per row (WP-4 correctness) even though the list is flat (comp).
  const attorneyRows: DocRowModel[] = [
    ...(approved ?? [])
      .filter((d) => match(humanizeKind(d.documentKind)))
      .map<DocRowModel>((d) => ({
        key: `a-${d.documentVersionId}`,
        name: humanizeKind(d.documentKind),
        tag: approvedTag(d.documentKind),
        matterLabel: matterLabel(d.matterNumber, d.matterEntityId),
        date: formatDate(d.approvedAt),
        icon: 'word',
        actions: [
          { label: t('portal.docs.view'), href: `/d/${d.documentVersionId}`, external: true },
        ],
      })),
    ...(esign ?? [])
      .filter((d) => match(d.documentTitle))
      .map<DocRowModel>((d) => ({
        key: `e-${d.requestId}`,
        name: d.documentTitle ?? t('portal.docs.title'),
        tag:
          d.state === 'signed'
            ? { label: t('portal.docs.tag_signed', undefined, 'Signed'), variant: 'ok' }
            : d.state === 'awaiting_you'
              ? {
                  label: t('portal.docs.tag_awaiting', undefined, 'Awaiting signature'),
                  variant: 'warn',
                }
              : { label: t('portal.docs.tag_document', undefined, 'Document'), variant: 'neutral' },
        matterLabel: matterLabel(d.matterNumber, d.matterEntityId),
        date: null,
        icon: 'pdf',
        actions: [
          {
            label: d.state === 'awaiting_you' ? t('portal.attention.sign') : t('portal.docs.view'),
            href: `/portal/sign/${d.requestId}`,
          },
        ],
      })),
  ]

  const uploadedRows: DocRowModel[] = (uploads ?? [])
    .filter((u) => match(u.originalFilename))
    .map<DocRowModel>((u) => {
      const mime = (u.contentType ?? '').toLowerCase().split(';')[0]?.trim()
      const canInline = INLINE_VIEW_MIMES.has(mime ?? '')
      const actions: DocRowModel['actions'] = u.available
        ? [
            ...(canInline
              ? [
                  {
                    label: t('portal.docs.view'),
                    href: `/api/client/portal/documents/${u.documentVersionId}/content`,
                    external: true,
                  },
                ]
              : []),
            {
              label: t('portal.docs.download'),
              href: `/api/client/portal/documents/${u.documentVersionId}/content?download=1`,
            },
          ]
        : []
      return {
        key: `u-${u.documentVersionId}`,
        name: u.originalFilename,
        tag: { label: t('portal.docs.tag_upload', undefined, 'Upload'), variant: 'neutral' },
        matterLabel: matterLabel(u.matterNumber, u.matterEntityId),
        date: `${formatBytes(u.sizeBytes)} · ${formatDate(u.uploadedAt)}`,
        icon: mime === 'application/pdf' || (mime ?? '').startsWith('image/') ? 'pdf' : 'word',
        actions: actions.length > 0 ? actions : [{ label: t('portal.docs.unavailable') }],
      }
    })

  const rows = tab === 'attorney' ? attorneyRows : uploadedRows

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.docs.title')}</h1>
      {uploadErr && (
        <div className="alert alert-error" role="alert">
          {uploadErr}
        </div>
      )}
      <section className="li-cp-card li-cp-docs">
        <div className="li-cp-docs-head">
          {/* A2.1d — a sub-tab filter, not a preference toggle (unlike the
              Settings language pill and SignDocument's type/draw mode), so it
              goes through the shared Tabs component (flat underline, gold
              active) rather than the pill-styled li-cp-seg family — li-cp-seg
              stays untouched for those other consumers. */}
          <Tabs
            tabs={[
              {
                key: 'attorney',
                label: t('portal.docs.from_attorney'),
                badge: attorneyRows.length,
              },
              { key: 'uploaded', label: t('portal.docs.uploaded'), badge: uploadedRows.length },
            ]}
            active={tab}
            onSelect={(key) => setTab(key as 'attorney' | 'uploaded')}
            ariaLabel={t('portal.docs.title')}
          />
          <div className="li-cp-docs-tools">
            <div className="li-cp-search">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden
              >
                <circle cx="11" cy="11" r="7" />
                <line x1="21" y1="21" x2="16.5" y2="16.5" />
              </svg>
              <input
                placeholder={t('portal.docs.search_all', undefined, 'Search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <UploadButton matters={matters} uploading={uploadingFor !== null} onFile={onFile} />
          </div>
        </div>

        {loading ? (
          <div className="loading-block" role="status">
            <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
          </div>
        ) : rows.length === 0 ? (
          <div className="li-cp-doc-empty">
            {q
              ? t('portal.docs.none_match_all', undefined, 'Nothing matches your search.')
              : t('portal.docs.empty')}
          </div>
        ) : (
          rows.map((row) => <DocRow key={row.key} row={row} />)
        )}
      </section>
    </>
  )
}

// Upload button — the comp has one "Upload" control. Uploads need a matter, so
// with a single matter we upload straight to it; with several the client picks.
function UploadButton({
  matters,
  uploading,
  onFile,
}: {
  matters: MatterListItem[]
  uploading: boolean
  onFile: (matterEntityId: string, file: File) => void
}) {
  const { t } = useI18n()
  const [pickOpen, setPickOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [pendingMatter, setPendingMatter] = useState<string | null>(null)

  useEffect(() => {
    if (!pickOpen) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setPickOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pickOpen])

  function chooseFor(matterEntityId: string) {
    setPendingMatter(matterEntityId)
    setPickOpen(false)
    // Defer so the hidden input is mounted with the chosen matter.
    requestAnimationFrame(() => fileRef.current?.click())
  }

  const label = uploading
    ? t('portal.docs.uploading')
    : t('portal.docs.upload_short', undefined, 'Upload')

  if (matters.length === 0) return null

  return (
    <div className="li-cp-upload" ref={wrapRef}>
      <input
        ref={fileRef}
        type="file"
        accept={UPLOAD_ACCEPT}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file && pendingMatter) onFile(pendingMatter, file)
        }}
      />
      <button
        type="button"
        className="li-cp-btn li-cp-btn--sm"
        disabled={uploading}
        onClick={() => {
          if (matters.length === 1) chooseFor(matters[0]!.matterEntityId)
          else setPickOpen((o) => !o)
        }}
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {label}
      </button>
      {pickOpen && (
        <div className="li-cp-upload-menu" role="menu">
          <div className="li-cp-upload-menu-head">
            {t('portal.docs.upload_to', undefined, 'Upload to which matter?')}
          </div>
          {matters.map((m) => (
            <button
              key={m.matterEntityId}
              type="button"
              className="li-cp-upload-menu-item"
              role="menuitem"
              onClick={() => chooseFor(m.matterEntityId)}
            >
              <span className="li-cp-upload-menu-title">
                {m.serviceLabel ?? t('portal.matter.generic')}
              </span>
              <span className="li-cp-upload-menu-meta">{m.matterNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Invoices — comp list + real Stripe/manual pay (navigates to the pay page) ─

interface BillingSummary {
  matters: Array<{
    matterEntityId: string
    matterNumber: string
    invoices: ClientInvoice[]
    accrued: Array<{ kind: string; date: string | null; description: string; amount: string }>
    accruedTotal: string
    dueTotal: string
    paidTotal: string
    runningTotal: string
  }>
  currency: string
  totals: { due: string; paid: string; accrued: string; running: string }
}

function InvoicesView() {
  const { t } = useI18n()
  const [invoices, setInvoices] = useState<ClientInvoice[] | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ invoices: ClientInvoice[] }>({ toolName: 'legal.client.invoices' })
      .then((r) => {
        setInvoices(r.invoices)
        // A prior transient failure (e.g. the shared-pooler EMAXCONNSESSION) must
        // not leave a stale error banner over freshly-loaded data.
        setError(null)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
        setInvoices([])
      })
    // Accrued not-yet-invoiced fees + running total — same computed source as
    // the firm's own billing panel. Best-effort: the invoices list stands alone.
    callClientPortalMcp<{ billing: BillingSummary }>({ toolName: 'legal.client.billing_summary' })
      .then((r) => setBilling(r.billing))
      .catch(() => setBilling(null))
  }, [])

  const showAccruing =
    billing &&
    (billing.matters.some((m) => m.accrued.length > 0) || Number(billing.totals.running) > 0)

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.nav.invoices', undefined, 'Invoices')}</h1>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {invoices === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : invoices.length === 0 ? (
        <section className="li-cp-card li-cp-list">
          <div className="li-cp-empty-row">
            {t(
              'portal.invoices.empty',
              undefined,
              'No invoices yet. They’ll appear here once the firm sends one.',
            )}
          </div>
        </section>
      ) : (
        <section className="li-cp-card li-cp-list">
          {invoices.map((inv) => (
            <div key={inv.invoiceEntityId} className="li-cp-inv-row">
              <span className="li-cp-inv-icon" aria-hidden>
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 4h9l5 5v11H4z" />
                  <path d="M13 4v5h5" />
                  <line x1="8" y1="13" x2="14" y2="13" />
                  <line x1="8" y1="17" x2="12" y2="17" />
                </svg>
              </span>
              <div className="li-cp-inv-main">
                <span className="li-cp-inv-num">{inv.invoiceNumber}</span>
                <span className="li-cp-inv-total">{formatMoney(inv.total, inv.currency)}</span>
                {inv.dueDate && inv.status !== 'paid' && (
                  <span className="li-cp-inv-due">
                    {t(
                      'portal.invoices.due',
                      { date: formatDate(inv.dueDate) },
                      `Due ${formatDate(inv.dueDate)}`,
                    )}
                  </span>
                )}
              </div>
              <span
                className={`li-cp-chip li-cp-chip--${inv.status === 'paid' ? 'ok' : 'warn'} li-cp-chip--plain`}
              >
                {inv.status === 'paid'
                  ? t('portal.invoices.paid', undefined, 'Paid')
                  : t('portal.invoices.due_label', undefined, 'Due')}
              </span>
              {inv.status === 'paid' ? (
                <a
                  className="li-cp-btn li-cp-btn--ghost li-cp-btn--sm"
                  href={`/portal/pay/${encodeURIComponent(inv.invoiceNumber)}`}
                >
                  {t('portal.invoices.receipt', undefined, 'Receipt')}
                </a>
              ) : (
                <a
                  className="li-cp-btn li-cp-btn--gold li-cp-btn--sm"
                  href={`/portal/pay/${encodeURIComponent(inv.invoiceNumber)}`}
                >
                  {t('portal.invoices.pay', undefined, 'Pay')}
                </a>
              )}
            </div>
          ))}
        </section>
      )}

      {showAccruing && billing && (
        <>
          <div className="li-cp-section-label">
            {t('portal.invoices.accruing', undefined, 'Accruing fees (not yet invoiced)')}
          </div>
          <section className="li-cp-card">
            {billing.matters.filter((m) => m.accrued.length > 0).length === 0 ? (
              <p className="li-cp-muted">
                {t('portal.invoices.accruing_none', undefined, 'No fees accruing right now.')}
              </p>
            ) : (
              billing.matters
                .filter((m) => m.accrued.length > 0)
                .map((m) => (
                  <div key={m.matterEntityId} className="li-cp-accrue">
                    <div className="li-cp-accrue-title">Matter {m.matterNumber}</div>
                    {m.accrued.map((e, i) => (
                      <div key={i} className="li-cp-accrue-row">
                        <div>
                          <div>{e.description}</div>
                          {e.date && (
                            <span className="li-cp-muted li-cp-small">{formatDate(e.date)}</span>
                          )}
                        </div>
                        <strong>{formatMoney(e.amount, billing.currency)}</strong>
                      </div>
                    ))}
                    <div className="li-cp-accrue-sub">
                      {t('portal.invoices.accrued', undefined, 'Accrued')}:{' '}
                      <strong>{formatMoney(m.accruedTotal, billing.currency)}</strong> ·{' '}
                      {t('portal.invoices.running', undefined, 'Running total')}:{' '}
                      <strong>{formatMoney(m.runningTotal, billing.currency)}</strong>
                    </div>
                  </div>
                ))
            )}
            <div className="li-cp-accrue-total">
              {t('portal.invoices.total_open', undefined, 'Total open')}{' '}
              {formatMoney(billing.totals.due, billing.currency)} ·{' '}
              {t('portal.invoices.accrued', undefined, 'Accrued')}{' '}
              {formatMoney(billing.totals.accrued, billing.currency)} ·{' '}
              {t('portal.invoices.running', undefined, 'Running total')}{' '}
              <strong>{formatMoney(billing.totals.running, billing.currency)}</strong>
            </div>
          </section>
        </>
      )}
    </>
  )
}

// ── Signatures — the client's e-sign requests (comp Signatures screen) ───────

function SignaturesView() {
  const { t } = useI18n()
  const [docs, setDocs] = useState<ClientDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ documents: ClientDocument[] }>({
      toolName: 'legal.esign.portal.documents',
    })
      .then((r) => {
        setDocs(r.documents)
        // Clear any stale transient-failure banner once data is in.
        setError(null)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
        setDocs([])
      })
  }, [])

  const stateChip = (state: ClientDocument['state']): { variant: string; label: string } => {
    switch (state) {
      case 'signed':
        return { variant: 'ok', label: t('portal.sig.signed', undefined, 'Signed') }
      case 'declined':
        return { variant: 'neutral', label: t('portal.sig.declined', undefined, 'Declined') }
      case 'in_progress':
        return { variant: 'info', label: t('portal.sig.in_progress', undefined, 'In progress') }
      default:
        return {
          variant: 'warn',
          label: t('portal.sig.awaiting', undefined, 'Awaiting your signature'),
        }
    }
  }

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.nav.signatures', undefined, 'Signatures')}</h1>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {docs === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : docs.length === 0 ? (
        <section className="li-cp-card li-cp-list">
          <div className="li-cp-empty-row">
            {t('portal.sig.empty', undefined, 'You have no documents awaiting your signature.')}
          </div>
        </section>
      ) : (
        <section className="li-cp-card li-cp-list">
          {docs.map((d) => {
            const chip = stateChip(d.state)
            const awaiting = d.state === 'awaiting_you'
            return (
              <div key={d.requestId} className="li-cp-sig-row">
                <span className="li-cp-sig-icon" aria-hidden>
                  <SigIcon />
                </span>
                <div className="li-cp-sig-main">
                  <span className="li-cp-sig-title">
                    {d.documentTitle ?? t('portal.docs.title')}
                  </span>
                  <span className="li-cp-sig-meta">{d.matterNumber ?? ''}</span>
                </div>
                <span className={`li-cp-chip li-cp-chip--${chip.variant} li-cp-chip--plain`}>
                  {chip.label}
                </span>
                <a
                  className={`li-cp-btn li-cp-btn--sm ${awaiting ? '' : 'li-cp-btn--ghost'}`}
                  href={`/portal/sign/${d.requestId}`}
                >
                  {awaiting ? t('portal.attention.sign') : t('portal.docs.view')}
                </a>
              </div>
            )
          })}
        </section>
      )}
    </>
  )
}

// ── Matter detail — timeline + requests + messages (reached from home) ───────

function MatterView({
  matterEntityId,
  matters,
  locked,
  onBack,
  onOpenGate,
}: {
  matterEntityId: string
  matters: MatterListItem[]
  locked: boolean
  onBack: () => void
  onOpenGate: () => void
}) {
  const { t } = useI18n()
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const matter = matters.find((m) => m.matterEntityId === matterEntityId)

  useEffect(() => {
    setTimeline(null)
    callClientPortalMcp<{ timeline: Timeline | null }>({
      toolName: 'legal.client.matter_timeline',
      input: { matterEntityId },
    })
      .then((r) => setTimeline(r.timeline))
      .catch(() => {})
  }, [matterEntityId])

  return (
    <>
      <BackHome onBack={onBack} />
      {!timeline ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : (
        <>
          {timeline.scheduledAt && <UpcomingEventCard timeline={timeline} />}
          <section className="li-cp-card">
            <div className="li-cp-card-head">
              <h2 className="li-cp-card-title">
                {matter?.serviceLabel
                  ? `${matter.serviceLabel} · ${timeline.matterNumber}`
                  : t('portal.matter.generic')}
              </h2>
              <StatusChip
                variant={timeline.statusChip === 'completed' ? 'neutral' : 'info'}
                label={t(`portal.matter.status.${timeline.statusChip}`)}
              />
            </div>
            {timeline.milestones.length === 0 ? (
              <p className="li-cp-muted">{t('portal.notif.empty')}</p>
            ) : (
              <ol className="li-cp-timeline">
                {timeline.milestones.map((m, i) => (
                  <li key={`${m.key}-${i}`}>
                    <span className="li-cp-timeline-dot" aria-hidden />
                    <div>
                      <div>{m.label}</div>
                      <div className="li-cp-muted li-cp-small">{formatDate(m.occurredAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {locked ? (
        <section className="li-cp-card li-cp-gate">
          <div className="li-cp-gate-lock" aria-hidden>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="4" y="10" width="16" height="11" rx="2" />
              <path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
          </div>
          <div className="li-cp-gate-txt">
            <h3>{t('portal.gate.title')}</h3>
            <p>{t('portal.gate.body')}</p>
          </div>
          <button type="button" className="li-cp-btn" onClick={onOpenGate}>
            {t('portal.gate.cta')}
          </button>
        </section>
      ) : (
        <>
          <RequestsPanel matterEntityId={matterEntityId} />
          <MessagesPanel matterEntityId={matterEntityId} />
        </>
      )}
    </>
  )
}

function UpcomingEventCard({ timeline }: { timeline: Timeline }) {
  const { t } = useI18n()
  const whenDate = timeline.scheduledAt ? parseTimestamp(timeline.scheduledAt) : null
  const when = whenDate
    ? whenDate.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
    : null
  return (
    <section className="li-cp-card li-cp-upcoming">
      <span className="li-cp-attn-ico li-cp-attn-ico--ok" aria-hidden>
        <CalIcon />
      </span>
      <div className="li-cp-upcoming-txt">
        <div className="li-cp-section-label" style={{ marginBottom: 2 }}>
          {t('portal.attention.consultation')}
        </div>
        <div className="li-cp-upcoming-when">{when}</div>
      </div>
      {timeline.canManageEvent && timeline.manageUrl && (
        <a className="li-cp-btn li-cp-btn--ghost li-cp-btn--sm" href={timeline.manageUrl}>
          {t('portal.attention.manage')}
        </a>
      )}
    </section>
  )
}

// ── Schedule (reached from the home Book CTA) ────────────────────────────────
function ScheduleView() {
  const { t } = useI18n()
  const [availability, setAvailability] = useState<{
    configured: boolean
    timezone: string
    meetingLengthsMinutes: number[]
    durationMinutes: number
    slots: Array<{ startIso: string; endIso: string; label: string }>
  } | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [quote, setQuote] = useState<{
    rate: string
    amount: string
    durationMinutes: number
    description: string
  } | null>(null)
  const [feeAccepted, setFeeAccepted] = useState(false)
  const [selectedSlot, setSelectedSlot] = useState<{ startIso: string; endIso: string } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ availability: typeof availability }>({
      toolName: 'legal.client.schedule_availability',
      input: duration ? { durationMinutes: duration } : {},
    })
      .then((r) => {
        setAvailability(r.availability)
        if (r.availability && duration === null) setDuration(r.availability.durationMinutes)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [duration])

  useEffect(() => {
    if (!duration) return
    setFeeAccepted(false)
    callClientPortalMcp<{ quote: typeof quote }>({
      toolName: 'legal.client.schedule_quote',
      input: { durationMinutes: duration },
    })
      .then((r) => setQuote(r.quote))
      .catch(() => setQuote(null))
  }, [duration])

  async function book() {
    if (!selectedSlot) return
    setBusy(true)
    setError(null)
    try {
      const r = await callClientPortalMcp<{
        result?: { bookingRef: string; startIso: string }
        feeConsentRequired?: boolean
        quote?: { rate: string; amount: string; durationMinutes: number; description: string }
      }>({
        toolName: 'legal.client.schedule_time',
        input: {
          startIso: selectedSlot.startIso,
          endIso: selectedSlot.endIso,
          durationMinutes: duration ?? undefined,
          feeAccepted: feeAccepted || undefined,
        },
      })
      if (r.feeConsentRequired && r.quote) {
        setQuote(r.quote)
        setError(
          t(
            'portal.schedule.consent_first',
            undefined,
            'Please review and accept the fee below, then confirm again.',
          ),
        )
        return
      }
      if (r.result) {
        setNotice(
          t(
            'portal.schedule.booked',
            { when: new Date(r.result.startIso).toLocaleString() },
            `Booked for ${new Date(r.result.startIso).toLocaleString()} — a calendar invitation and confirmation email are on the way.`,
          ),
        )
        setSelectedSlot(null)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.rail.book.title')}</h1>
      <section className="li-cp-card">
        <p className="li-cp-muted" style={{ marginTop: 0 }}>
          {t(
            'portal.schedule.book_lead',
            undefined,
            'Book another service — signed in, your details and previous answers are prefilled.',
          )}
        </p>
        <a className="li-cp-btn li-cp-btn--ghost" href="/book">
          {t('portal.schedule.book_service', undefined, 'Book a service')}
        </a>
      </section>

      <section className="li-cp-card">
        <h2 className="li-cp-card-title">
          {t('portal.schedule.title', undefined, 'Schedule time with the firm')}
        </h2>
        {notice && <div className="alert alert-success">{notice}</div>}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {availability === null ? (
          <div className="loading-block" role="status">
            <span className="spinner" />{' '}
            {t('portal.schedule.checking', undefined, 'Checking availability…')}
          </div>
        ) : !availability.configured ? (
          <p className="li-cp-muted">
            {t(
              'portal.schedule.unavailable',
              undefined,
              'Online scheduling isn’t available right now — message the firm and they’ll find a time with you.',
            )}
          </p>
        ) : (
          <>
            {availability.meetingLengthsMinutes.length > 1 && (
              <div className="li-cp-field">
                <label className="li-cp-label">
                  {t('portal.schedule.length', undefined, 'Length')}
                </label>
                <select
                  className="li-cp-select"
                  value={duration ?? availability.durationMinutes}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {availability.meetingLengthsMinutes.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </div>
            )}
            {availability.slots.length === 0 ? (
              <p className="li-cp-muted">
                {t('portal.schedule.no_slots', undefined, 'No open times in the next few weeks.')}
              </p>
            ) : (
              <div className="li-cp-slots">
                {availability.slots.slice(0, 24).map((slot) => (
                  <button
                    key={slot.startIso}
                    type="button"
                    className={`li-cp-slot ${selectedSlot?.startIso === slot.startIso ? 'active' : ''}`}
                    onClick={() => setSelectedSlot(slot)}
                  >
                    {new Date(slot.startIso).toLocaleString(undefined, {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </button>
                ))}
              </div>
            )}
            {quote && (
              <FeeConsentCard
                quote={{
                  basis: 'hourly-rate',
                  amount: quote.amount,
                  rate: quote.rate,
                  currency: 'USD',
                  description: quote.description,
                }}
                accepted={feeAccepted}
                onAccept={setFeeAccepted}
                t={t}
              />
            )}
            <button
              type="button"
              className="li-cp-btn"
              disabled={!selectedSlot || busy || (Boolean(quote) && !feeAccepted)}
              onClick={book}
            >
              {busy
                ? t('portal.schedule.booking', undefined, 'Booking…')
                : t('portal.schedule.confirm', undefined, 'Confirm time')}
            </button>
          </>
        )}
      </section>
    </>
  )
}

const REQUEST_TYPE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  document: 'Document',
  review: 'Attorney review',
}
const REQUEST_STATUS_LABEL: Record<string, string> = {
  requested: 'Requested',
  accepted: 'Accepted',
  in_progress: 'In progress',
  fulfilled: 'Fulfilled',
  declined: 'Declined',
}

// Cost-gated self-serve requests: the client picks a type, sees the price, ACCEPTS
// it, and submits. The attorney then works it. The price is recomputed server-side
// on submit; the quote here is just the preview the client agrees to.
function RequestsPanel({ matterEntityId }: { matterEntityId: string }) {
  const { t } = useI18n()
  const [requests, setRequests] = useState<ClientRequest[] | null>(null)
  const [type, setType] = useState<RequestType>('meeting')
  const [duration, setDuration] = useState(60)
  const [description, setDescription] = useState('')
  const [quote, setQuote] = useState<RequestQuote | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    callClientPortalMcp<{ requests: ClientRequest[] }>({ toolName: 'legal.client.request_list' })
      .then((r) => setRequests(r.requests))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
        setRequests([])
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    setQuote(null)
  }, [type, duration])

  async function getQuote() {
    setError(null)
    setBusy(true)
    try {
      const r = await callClientPortalMcp<{ quote: RequestQuote }>({
        toolName: 'legal.client.request_quote',
        input: { requestType: type, durationMinutes: type === 'meeting' ? duration : null },
      })
      setQuote(r.quote)
    } catch (e) {
      if (!(e instanceof PortalSessionExpiredError)) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  async function accept() {
    setError(null)
    setBusy(true)
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.request_create',
        input: {
          matterEntityId,
          requestType: type,
          durationMinutes: type === 'meeting' ? duration : null,
          description: description.trim() || null,
        },
      })
      setQuote(null)
      setDescription('')
      load()
    } catch (e) {
      if (!(e instanceof PortalSessionExpiredError)) {
        setError(e instanceof Error ? e.message : String(e))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="li-cp-card">
      <h2 className="li-cp-card-title">
        {t('portal.requests.title', undefined, 'Make a request')}
      </h2>
      <p className="li-cp-muted" style={{ marginTop: 0 }}>
        {t(
          'portal.requests.lead',
          undefined,
          'Request a meeting, a document, or an attorney review. You’ll see the cost and accept it before it’s submitted.',
        )}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="li-cp-form" style={{ maxWidth: 460 }}>
        <div className="li-cp-field">
          <label className="li-cp-label" htmlFor="req-type">
            {t('portal.requests.what', undefined, 'What do you need?')}
          </label>
          <select
            id="req-type"
            className="li-cp-select"
            value={type}
            onChange={(e) => setType(e.target.value as RequestType)}
          >
            <option value="meeting">{t('portal.requests.meeting', undefined, 'Meeting')}</option>
            <option value="document">{t('portal.requests.document', undefined, 'Document')}</option>
            <option value="review">
              {t('portal.requests.review', undefined, 'Attorney review')}
            </option>
          </select>
        </div>

        {type === 'meeting' && (
          <div className="li-cp-field">
            <label className="li-cp-label" htmlFor="req-dur">
              {t('portal.requests.how_long', undefined, 'How long?')}
            </label>
            <select
              id="req-dur"
              className="li-cp-select"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value={30}>30 {t('portal.requests.minutes', undefined, 'minutes')}</option>
              <option value={60}>60 {t('portal.requests.minutes', undefined, 'minutes')}</option>
              <option value={90}>90 {t('portal.requests.minutes', undefined, 'minutes')}</option>
            </select>
          </div>
        )}

        <div className="li-cp-field">
          <label className="li-cp-label" htmlFor="req-desc">
            {t('portal.requests.details', undefined, 'Details (optional)')}
          </label>
          <textarea
            id="req-desc"
            className="li-cp-textarea"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t(
              'portal.requests.details_ph',
              undefined,
              'Tell the attorney what you need…',
            )}
          />
        </div>

        {!quote ? (
          <button type="button" className="li-cp-btn" disabled={busy} onClick={getQuote}>
            {busy
              ? t('portal.requests.pricing', undefined, 'Getting price…')
              : t('portal.requests.see_cost', undefined, 'See the cost')}
          </button>
        ) : (
          <div className="li-cp-quote">
            <div>
              <strong>{formatMoney(quote.amount, quote.currency)}</strong> — {quote.basis}
            </div>
            <div className="li-cp-quote-actions">
              <button type="button" className="li-cp-btn" disabled={busy} onClick={accept}>
                {busy
                  ? t('portal.requests.submitting', undefined, 'Submitting…')
                  : t('portal.requests.accept', undefined, 'Accept & submit')}
              </button>
              <button
                type="button"
                className="li-cp-linkbtn"
                disabled={busy}
                onClick={() => setQuote(null)}
              >
                {t('portal.gate.cancel')}
              </button>
            </div>
          </div>
        )}
      </div>

      {requests && requests.length > 0 && (
        <>
          <div className="li-cp-section-label">
            {t('portal.requests.your', undefined, 'Your requests')}
          </div>
          <div className="li-cp-list li-cp-list--flush">
            {requests.map((r) => (
              <div key={r.requestEntityId} className="li-cp-req-row">
                <span className="li-cp-req-title">
                  {REQUEST_TYPE_LABEL[r.requestType] ?? r.requestType} ·{' '}
                  {formatMoney(r.amount, r.currency)}
                </span>
                <span className="li-cp-chip li-cp-chip--neutral li-cp-chip--plain">
                  {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// Two-way messaging with the attorney for the selected matter.
function MessagesPanel({ matterEntityId }: { matterEntityId: string }) {
  const { t } = useI18n()
  const firmName = useFirmName()
  const [messages, setMessages] = useState<PortalMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await callClientPortalMcp<{ messages: PortalMessage[] }>({
        toolName: 'legal.client.thread_get',
        input: { matterEntityId },
      })
      setMessages(r.messages)
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return
      setError(e instanceof Error ? e.message : String(e))
      setMessages((prev) => prev ?? [])
    }
  }, [matterEntityId])

  useEffect(() => {
    setMessages(null)
    setError(null)
    load()
  }, [load])

  async function send() {
    if (busy || !draft.trim()) return
    setBusy(true)
    setError(null)
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.message_post',
        input: { matterEntityId, body: draft.trim() },
      })
      setDraft('')
      await load()
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="li-cp-card">
      <h2 className="li-cp-card-title">{t('portal.messages.label')}</h2>
      <p className="li-cp-muted li-cp-small" style={{ marginTop: 0 }}>
        {t('portal.messages.lead', undefined, 'Message your attorney about this matter.')}
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {messages === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : messages.length === 0 ? (
        <p className="li-cp-muted">
          {t('portal.messages.start', undefined, 'No messages yet. Start the conversation below.')}
        </p>
      ) : (
        <div className="li-cp-thread" role="log" aria-live="polite" aria-label="Messages">
          {messages.map((m, i) => (
            <div
              key={`${m.sentAt}-${i}`}
              className={`li-cp-bubble-row ${m.author === 'client' ? 'me' : ''}`}
            >
              <div className={`li-cp-bubble ${m.author === 'client' ? 'me' : ''}`}>
                <div className="li-cp-bubble-body">{m.body}</div>
                <div className="li-cp-bubble-meta">
                  {m.author === 'client' ? t('portal.messages.you') : firmName} ·{' '}
                  {formatDateTime(m.sentAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="li-cp-compose">
        <textarea
          className="li-cp-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder={t('portal.messages.write', undefined, 'Write a message…')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
        />
        <button type="button" className="li-cp-btn" onClick={send} disabled={busy || !draft.trim()}>
          {busy
            ? t('portal.messages.sending', undefined, 'Sending…')
            : t('portal.messages.send', undefined, 'Send')}
        </button>
      </div>
    </section>
  )
}

// ── Settings — honest subset (no client profile-edit / notif-prefs / cards /
//    adopt-signature capability exists; those comp cards are omitted). ────────

function SettingsView({ me }: { me: MeResponse }) {
  const { t, lang, setLang } = useI18n()
  return (
    <>
      <h1 className="li-cp-h1">{t('portal.nav.settings', undefined, 'Settings')}</h1>
      <div className="li-cp-settings">
        <section className="li-cp-card">
          <h3 className="li-cp-set-h3">
            {t('portal.settings.details', undefined, 'Your details')}
          </h3>
          <div className="li-cp-set-grid">
            <div className="li-cp-set-kv">
              <span className="li-cp-set-k">
                {t('portal.settings.name', undefined, 'Full name')}
              </span>
              <span className="li-cp-set-v">{me.displayName}</span>
            </div>
            <div className="li-cp-set-kv">
              <span className="li-cp-set-k">{t('portal.settings.email', undefined, 'Email')}</span>
              <span className="li-cp-set-v">{me.email}</span>
            </div>
          </div>
          <p className="li-cp-muted li-cp-small" style={{ marginTop: 'var(--space-3, 1rem)' }}>
            {t(
              'portal.settings.contact_note',
              undefined,
              'To update your details, message your attorney.',
            )}
          </p>
        </section>

        <section className="li-cp-card">
          <h3 className="li-cp-set-h3">
            {t('portal.settings.language', undefined, 'Preferred language')}
          </h3>
          <div className="li-cp-seg li-cp-seg--wide">
            <button
              type="button"
              className={`li-cp-seg-btn ${lang === 'en' ? 'active' : ''}`}
              onClick={() => setLang('en')}
            >
              English
            </button>
            <button
              type="button"
              className={`li-cp-seg-btn ${lang === 'es' ? 'active' : ''}`}
              onClick={() => setLang('es')}
            >
              Español
            </button>
          </div>
        </section>
      </div>
    </>
  )
}

// ── Assistant (WP-7) — the comp's full-tab portal AI assistant ───────────────

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}
interface RequestCard {
  prefill: {
    requestType: string
    matterEntityId: string
    description: string
    durationMinutes: number | null
  }
  quote: { amount: string; currency: string; basis: string; label: string }
}

// PORTAL-1 (WP5) — the portal chatbot: streams over the client-scoped tool
// surface; a request needing the client's consent renders as a card whose
// button — the client's OWN click — files the cost-accepted request.
function AssistantView() {
  const { t, lang } = useI18n()
  const firmName = useFirmName()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<RequestCard | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [cardDone, setCardDone] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // FB-0 — per-message thumbs feedback, keyed by position in `messages` (stable:
  // messages only append). The modal captures an optional note, then submits
  // the verdict + note + a snapshot of the whole visible conversation.
  const [messageFeedback, setMessageFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const [feedbackModal, setFeedbackModal] = useState<{
    messageIndex: number
    verdict: 'up' | 'down'
    note: string
    busy: boolean
    error: string | null
  } | null>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, card, cardDone])

  function openFeedbackModal(messageIndex: number, verdict: 'up' | 'down') {
    setFeedbackModal({ messageIndex, verdict, note: '', busy: false, error: null })
  }

  async function submitFeedbackModal() {
    const m = feedbackModal
    if (!m || m.busy) return
    setFeedbackModal({ ...m, busy: true, error: null })
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.message_feedback_submit',
        input: {
          verdict: m.verdict,
          note: m.note.trim() || undefined,
          messageIndex: m.messageIndex,
          transcript: messages.map((msg) => ({ role: msg.role, content: msg.content })),
        },
      })
      setMessageFeedback((prev) => ({ ...prev, [m.messageIndex]: m.verdict }))
      setFeedbackModal(null)
    } catch (e) {
      if (e instanceof PortalSessionExpiredError) return
      setFeedbackModal((prev) =>
        prev ? { ...prev, busy: false, error: e instanceof Error ? e.message : String(e) } : null,
      )
    }
  }

  const suggestions = [
    t('portal.assistant.s1', undefined, 'What’s the status of my matter?'),
    t('portal.assistant.s2', undefined, 'When is my next consultation?'),
    t('portal.assistant.s3', undefined, 'How do I pay my invoice?'),
  ]

  async function send(preset?: string) {
    const message = (preset ?? input).trim()
    if (!message || busy) return
    setInput('')
    setCard(null)
    setCardDone(null)
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: message },
      { role: 'assistant', content: '' },
    ])
    setBusy(true)
    try {
      const res = await fetch('/api/client/portal/assistant/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          history: messages.slice(-12),
          // WP A3 — the portal's current language, so a Spanish-speaking client
          // is answered in Spanish from the first message.
          locale: lang,
        }),
      })
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(err?.error ?? 'The assistant is unavailable right now.')
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '))
          if (!line) continue
          let event: { type: string; text?: string; card?: RequestCard }
          try {
            event = JSON.parse(line.slice(6))
          } catch {
            continue
          }
          if (event.type === 'text' && event.text) {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant') {
                next[next.length - 1] = { role: 'assistant', content: last.content + event.text }
              }
              return next
            })
          } else if (event.type === 'request_card' && event.card) {
            setCard(event.card)
          } else if (event.type === 'error' && event.text) {
            setMessages((prev) => {
              const next = [...prev]
              const last = next[next.length - 1]
              if (last?.role === 'assistant' && !last.content) {
                next[next.length - 1] = { role: 'assistant', content: event.text as string }
              }
              return next
            })
          }
        }
      }
    } catch (e) {
      setMessages((prev) => {
        const next = [...prev]
        const last = next[next.length - 1]
        const text = e instanceof Error ? e.message : String(e)
        if (last?.role === 'assistant' && !last.content) {
          next[next.length - 1] = { role: 'assistant', content: text }
        }
        return next
      })
    } finally {
      setBusy(false)
    }
  }

  async function confirmRequest() {
    if (!card || cardBusy) return
    setCardBusy(true)
    try {
      await callClientPortalMcp({
        toolName: 'legal.client.request_create',
        input: {
          matterEntityId: card.prefill.matterEntityId,
          requestType: card.prefill.requestType,
          description: card.prefill.description,
          durationMinutes: card.prefill.durationMinutes ?? undefined,
        },
      })
      setCard(null)
      setCardDone(
        t(
          'portal.assistant.filed',
          undefined,
          'Request filed — the firm has been notified and will review it.',
        ),
      )
    } catch (e) {
      setCardDone(e instanceof Error ? e.message : String(e))
    } finally {
      setCardBusy(false)
    }
  }

  const empty = messages.length === 0

  return (
    <>
      <h1 className="li-cp-h1">{t('portal.assistant.title')}</h1>
      <div className="li-cp-asst-wrap">
        <div className="li-cp-asst">
          <div className="li-cp-asst-head">
            <GemStar />
            <span>{t('portal.assistant.name', { firm: firmName }, `${firmName} Assistant`)}</span>
          </div>
          <div className="li-cp-asst-body" ref={scrollRef}>
            {empty ? (
              <div className="li-cp-asst-empty">
                <div className="li-cp-asst-empty-h">
                  {t('portal.assistant.empty_h', undefined, 'How can I help you today?')}
                </div>
                <div className="li-cp-asst-empty-p">
                  {t(
                    'portal.assistant.empty_p',
                    undefined,
                    'Ask about your matter, documents, scheduling, or payments.',
                  )}
                </div>
                <div className="li-cp-asst-suggest">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="li-cp-asst-chip"
                      onClick={() => send(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`li-cp-asst-msgrow ${m.role === 'user' ? 'me' : ''}`}>
                  <div className="li-cp-asst-msgcol">
                    <div className={`li-cp-asst-msg ${m.role === 'user' ? 'me' : ''}`}>
                      {m.content || (busy && i === messages.length - 1 ? '…' : '')}
                    </div>
                    {/* FB-0 — thumbs on every assistant reply, once it has settled
                        (not the still-streaming last bubble). */}
                    {m.role === 'assistant' &&
                      m.content &&
                      !(busy && i === messages.length - 1) && (
                        <div className="li-cp-asst-fbk">
                          <button
                            type="button"
                            className={`li-cp-asst-fbk-btn${messageFeedback[i] === 'up' ? ' li-cp-asst-fbk-btn-active' : ''}`}
                            aria-pressed={messageFeedback[i] === 'up'}
                            aria-label={t(
                              'portal.assistant.fb_helpful',
                              undefined,
                              'Mark this reply helpful',
                            )}
                            onClick={() => openFeedbackModal(i, 'up')}
                          >
                            <ThumbsUp
                              size={13}
                              fill={messageFeedback[i] === 'up' ? 'currentColor' : 'none'}
                            />
                          </button>
                          <button
                            type="button"
                            className={`li-cp-asst-fbk-btn${messageFeedback[i] === 'down' ? ' li-cp-asst-fbk-btn-active' : ''}`}
                            aria-pressed={messageFeedback[i] === 'down'}
                            aria-label={t(
                              'portal.assistant.fb_unhelpful',
                              undefined,
                              'Mark this reply not helpful',
                            )}
                            onClick={() => openFeedbackModal(i, 'down')}
                          >
                            <ThumbsDown
                              size={13}
                              fill={messageFeedback[i] === 'down' ? 'currentColor' : 'none'}
                            />
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              ))
            )}
            {card && (
              <div className="li-cp-asst-card">
                <strong>{t('portal.assistant.confirm', undefined, 'Confirm your request')}</strong>
                <div className="li-cp-asst-card-desc">
                  {card.prefill.description}
                  <br />
                  {t('portal.assistant.fee', undefined, 'Fee')}:{' '}
                  <strong>${card.quote.amount}</strong>{' '}
                  <span className="li-cp-muted">({card.quote.basis})</span>
                </div>
                <button
                  type="button"
                  className="li-cp-btn li-cp-btn--sm"
                  disabled={cardBusy}
                  onClick={confirmRequest}
                >
                  {cardBusy
                    ? t('portal.requests.submitting', undefined, 'Filing…')
                    : t('portal.assistant.file', undefined, 'Accept fee & file request')}
                </button>
              </div>
            )}
            {cardDone && <div className="li-cp-asst-note">{cardDone}</div>}
          </div>
          <div className="li-cp-asst-composer">
            <input
              value={input}
              placeholder={t('portal.assistant.placeholder', undefined, 'Ask the assistant…')}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void send()
                }
              }}
            />
            <button
              type="button"
              className="li-cp-asst-send"
              aria-label={t('portal.messages.send', undefined, 'Send')}
              disabled={busy || !input.trim()}
              onClick={() => void send()}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M22 2 11 13" />
                <path d="M22 2 15 22l-4-9-9-4z" />
              </svg>
            </button>
          </div>
        </div>
        <p className="li-cp-asst-disclaimer">
          {t(
            'portal.assistant.disclaimer',
            undefined,
            'For legal questions the assistant routes you to the attorney — it doesn’t give legal advice.',
          )}
        </p>
      </div>
      {feedbackModal && (
        <PortalMessageFeedbackModal
          verdict={feedbackModal.verdict}
          note={feedbackModal.note}
          busy={feedbackModal.busy}
          error={feedbackModal.error}
          onNoteChange={(note) => setFeedbackModal((prev) => (prev ? { ...prev, note } : prev))}
          onCancel={() => setFeedbackModal(null)}
          onSubmit={() => void submitFeedbackModal()}
        />
      )}
    </>
  )
}

// FB-0 — the tiny thumbs-feedback note modal for the portal assistant chat,
// styled like the portal's own modal chrome (EngagementGateModal above).
function PortalMessageFeedbackModal({
  verdict,
  note,
  busy,
  error,
  onNoteChange,
  onCancel,
  onSubmit,
}: {
  verdict: 'up' | 'down'
  note: string
  busy: boolean
  error: string | null
  onNoteChange: (note: string) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className="li-cp-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('portal.assistant.fb_title', undefined, 'Rate this reply')}
      onClick={onCancel}
    >
      <div className="li-cp-modal" onClick={(e) => e.stopPropagation()}>
        <div className="li-cp-modal-head">
          <h2 className="li-cp-modal-title li-fbk-modal-title">
            {verdict === 'up' ? (
              <ThumbsUp size={16} fill="currentColor" />
            ) : (
              <ThumbsDown size={16} fill="currentColor" />
            )}
            {verdict === 'up'
              ? t('portal.assistant.fb_marked_helpful', undefined, 'Marked helpful')
              : t('portal.assistant.fb_marked_unhelpful', undefined, 'Marked not helpful')}
          </h2>
          <button
            type="button"
            className="li-cp-modal-x"
            aria-label={t('portal.gate.cancel', undefined, 'Cancel')}
            onClick={onCancel}
          >
            <CloseIcon />
          </button>
        </div>
        <div className="li-cp-modal-body">
          <label className="li-fbk-modal-label" htmlFor="li-cp-fbk-note">
            {t('portal.assistant.fb_note_label', undefined, 'Add a note (optional)')}
          </label>
          <textarea
            id="li-cp-fbk-note"
            className="li-fbk-modal-textarea"
            rows={3}
            value={note}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder={t(
              'portal.assistant.fb_note_placeholder',
              undefined,
              'What made this reply good or bad?',
            )}
            autoFocus
          />
          {error && (
            <div className="alert alert-error" role="alert">
              {error}
            </div>
          )}
        </div>
        <div className="li-cp-modal-foot">
          <button
            type="button"
            className="li-cp-btn li-cp-btn--ghost"
            onClick={onCancel}
            disabled={busy}
          >
            {t('portal.assistant.fb_cancel', undefined, 'Cancel')}
          </button>
          <button type="button" className="li-cp-btn" onClick={onSubmit} disabled={busy}>
            {busy
              ? t('portal.assistant.fb_submitting', undefined, 'Submitting…')
              : t('portal.assistant.fb_submit', undefined, 'Submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

// The comp gemstar (the one AI affordance) — inline so the portal (outside
// .li-shell) still animates it via the shared .li-gemstar rule.
function GemStar() {
  return (
    <svg className="li-gemstar" width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="liCpGem" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c6a968" />
          <stop offset="1" stopColor="#d8c084" />
        </linearGradient>
      </defs>
      <path
        d="M12 3.3c.5 4.1 2.3 5.9 6.4 6.4-4.1.5-5.9 2.3-6.4 6.4-.5-4.1-2.3-5.9-6.4-6.4 4.1-.5 5.9-2.3 6.4-6.4z"
        fill="url(#liCpGem)"
      />
      <path
        d="M19.4 2c.2 1.6.9 2.3 2.5 2.5-1.6.2-2.3.9-2.5 2.5-.2-1.6-.9-2.3-2.5-2.5 1.6-.2 2.3-.9 2.5-2.5z"
        fill="url(#liCpGem)"
        style={{ animationDelay: '.4s' }}
      />
    </svg>
  )
}
