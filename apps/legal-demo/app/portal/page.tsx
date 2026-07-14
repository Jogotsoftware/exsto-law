'use client'

import { useCallback, useEffect, useState } from 'react'
import { ScaleIcon } from '@/components/icons'
import { FeeConsentCard } from '@/components/FeeConsentCard'
import { LanguageToggle } from '@/components/LanguageToggle'
import { useI18n } from '@/lib/i18n'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'
import { formatDate, formatDateTime, parseTimestamp } from '@/lib/datetime'

// CLIENT-PORTAL-UI-1 — the portal home is a CROSS-MATTER dashboard (greeting,
// attention band, matters list, rail), nav reduces to Home · Documents · a
// notifications bell, and everything else is reached from home cards. All copy
// goes through the i18n layer (client-copy doctrine: no internal step names,
// kind keys, or attorney verbiage — the server projections only hand us
// client-safe fields to begin with).

interface MeResponse {
  email: string
  displayName: string
  matterCount: number
}
interface MatterListItem {
  matterEntityId: string
  matterNumber: string
  statusKey: string
  statusLabel: string
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
  ref: string | null
  unread: boolean
}

type View =
  | { kind: 'home' }
  | { kind: 'documents' }
  | { kind: 'notifications' }
  | { kind: 'billing' }
  | { kind: 'schedule' }
  | { kind: 'matter'; matterEntityId: string }

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

  return (
    <div className="cp-shell">
      <header className="cp-top">
        <div className="cp-top-inner">
          <button
            type="button"
            className="cp-brand cp-brand-btn"
            onClick={() => setView({ kind: 'home' })}
            aria-label={t('portal.nav.home', undefined, 'Home')}
          >
            <span className="cp-crest" aria-hidden>
              <ScaleIcon size={18} />
            </span>
            <span className="cp-brand-text">
              <span className="cp-brand-name">Pacheco Law</span>
              <span className="cp-brand-sub">Client Portal</span>
            </span>
          </button>
          <div className="cp-top-right">
            <LanguageToggle />
            {me && (
              <span className="cp-who" title={me.email}>
                {me.displayName}
              </span>
            )}
            <a href="/api/client/auth/logout" className="cp-signout">
              {t('portal.signout', undefined, 'Sign out')}
            </a>
          </div>
        </div>
        <nav className="cp-nav" aria-label="Portal sections">
          <div className="cp-nav-inner">
            <button
              type="button"
              className={`cp-tab ${view.kind === 'home' ? 'active' : ''}`}
              aria-current={view.kind === 'home' ? 'page' : undefined}
              onClick={() => setView({ kind: 'home' })}
            >
              {t('portal.nav.home', undefined, 'Home')}
            </button>
            <button
              type="button"
              className={`cp-tab ${view.kind === 'documents' ? 'active' : ''}`}
              aria-current={view.kind === 'documents' ? 'page' : undefined}
              onClick={() => setView({ kind: 'documents' })}
            >
              {t('portal.nav.documents', undefined, 'Documents')}
            </button>
            <button
              type="button"
              className={`cp-tab cp-tab-bell ${view.kind === 'notifications' ? 'active' : ''}`}
              aria-current={view.kind === 'notifications' ? 'page' : undefined}
              aria-label={t('portal.nav.notifications', undefined, 'Notifications')}
              onClick={() => setView({ kind: 'notifications' })}
            >
              <BellIcon />
              {badge > 0 && <span className="cph-badge">{badge > 9 ? '9+' : badge}</span>}
            </button>
          </div>
        </nav>
      </header>

      <main className="cp-main">
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
                onOpenBilling={() => setView({ kind: 'billing' })}
                onOpenSchedule={() => setView({ kind: 'schedule' })}
                onOpenGate={() => setGateOpen(true)}
              />
            )}
            {view.kind === 'documents' && <DocumentsView matters={home.matters} />}
            {view.kind === 'notifications' && (
              <NotificationsView
                onBadge={setBadge}
                onOpenMatter={(id) => setView({ kind: 'matter', matterEntityId: id })}
                onOpenBilling={() => setView({ kind: 'billing' })}
                onOpenDocuments={() => setView({ kind: 'documents' })}
              />
            )}
            {view.kind === 'billing' && (
              <>
                <BackHome onBack={() => setView({ kind: 'home' })} />
                <InvoicesPanel />
              </>
            )}
            {view.kind === 'schedule' && (
              <>
                <BackHome onBack={() => setView({ kind: 'home' })} />
                <SchedulePanel />
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

      {/* WP-7 — the assistant is a floating control, rendered ONLY for enabled
          clients (flag off ⇒ absent from the DOM, not hidden). */}
      {home?.assistantEnabled && <AssistantBubble />}
    </div>
  )
}

function BellIcon() {
  return (
    <svg
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
  )
}

function BackHome({ onBack }: { onBack: () => void }) {
  const { t } = useI18n()
  return (
    <button type="button" className="cph-back" onClick={onBack}>
      ← {t('portal.back_home', undefined, 'Back to home')}
    </button>
  )
}

// ── Home (WP-1) ──────────────────────────────────────────────────────────────

function HomeView({
  home,
  locked,
  onOpenMatter,
  onOpenBilling,
  onOpenSchedule,
  onOpenGate,
}: {
  home: HomeSummary
  locked: boolean
  onOpenMatter: (id: string) => void
  onOpenBilling: () => void
  onOpenSchedule: () => void
  onOpenGate: () => void
}) {
  const { t } = useI18n()
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
      <h1 className="cph-greeting">{t(greetKey, { name }, `Good afternoon${name}.`)}</h1>

      {home.attention.length > 0 && (
        <section className="pdash-card cph-attention" aria-label={t('portal.attention.label')}>
          {home.attention.map((item, i) =>
            item.kind === 'consultation' ? (
              <div className="cph-attn-row" key={`c-${i}`}>
                <div className="cph-attn-ico" aria-hidden>
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="4" width="18" height="17" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                </div>
                <div className="cph-attn-txt">
                  <div className="cph-attn-k">{t('portal.attention.consultation')}</div>
                  <div className="cph-attn-v">
                    {parseTimestamp(item.scheduledAt)?.toLocaleString(undefined, {
                      dateStyle: 'full',
                      timeStyle: 'short',
                    })}
                  </div>
                  <div className="cph-attn-m">{item.matterNumber}</div>
                </div>
                {item.manageUrl && (
                  <a className="pdash-btn pdash-btn-sm" href={item.manageUrl}>
                    {t('portal.attention.manage')}
                  </a>
                )}
              </div>
            ) : (
              <div className="cph-attn-row" key={`s-${i}`}>
                <div className="cph-attn-ico" aria-hidden>
                  <svg
                    width="19"
                    height="19"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                  </svg>
                </div>
                <div className="cph-attn-txt">
                  <div className="cph-attn-k">{t('portal.attention.signature')}</div>
                  <div className="cph-attn-v">{item.documentTitle ?? t('portal.docs.title')}</div>
                  {item.matterNumber && <div className="cph-attn-m">{item.matterNumber}</div>}
                </div>
                <a
                  className="pdash-btn pdash-btn-sm cph-btn-accent"
                  href={`/portal/sign/${item.requestId}`}
                >
                  {t('portal.attention.sign')}
                </a>
              </div>
            ),
          )}
        </section>
      )}

      <div className="cph-grid">
        <section aria-label={t('portal.matters.label')}>
          <p className="cph-section-label">{t('portal.matters.label')}</p>
          {home.matters.length === 0 ? (
            <div className="pdash-card pdash-empty">{t('portal.matters.empty')}</div>
          ) : (
            <div className="pdash-card cph-matters">
              {home.matters.map((m) => (
                <button
                  type="button"
                  key={m.matterEntityId}
                  className="cph-matter"
                  onClick={() => onOpenMatter(m.matterEntityId)}
                >
                  <span className="cph-matter-main">
                    <span className="cph-matter-title">
                      {m.serviceLabel ?? m.matterNumber}
                      {m.archived && (
                        <span
                          className="pdash-badge-sm pdash-badge-muted"
                          style={{ marginLeft: 8 }}
                        >
                          {t('portal.matters.archived')}
                        </span>
                      )}
                    </span>
                    <span className="cph-matter-meta">
                      {formatOpened(m.openedAt)} · {m.matterNumber}
                    </span>
                  </span>
                  <span
                    className={`cph-chip ${
                      signatureMatters.has(m.matterNumber)
                        ? 'cph-chip-warn'
                        : consultationMatters.has(m.matterNumber)
                          ? 'cph-chip-ok'
                          : ''
                    }`}
                  >
                    {m.statusLabel}
                  </span>
                  <span className="cph-chev" aria-hidden>
                    ›
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="cph-rail">
          {locked ? (
            <div className="pdash-card cph-gate">
              <div className="cph-gate-lock" aria-hidden>
                <svg
                  width="18"
                  height="18"
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
              <h3>{t('portal.gate.title')}</h3>
              <p>{t('portal.gate.body')}</p>
              {home.engagement.rate && (
                <div className="cph-gate-rate">
                  {t('portal.gate.rate', { rate: home.engagement.rate })}
                </div>
              )}
              <button type="button" className="pdash-btn pdash-btn-primary" onClick={onOpenGate}>
                {t('portal.gate.cta')}
              </button>
              <div className="cph-gate-note">{t('portal.gate.note')}</div>
            </div>
          ) : (
            <div className="pdash-card cph-cta">
              <h3>{t('portal.rail.book.title')}</h3>
              <p>{t('portal.rail.book.body')}</p>
              <button
                type="button"
                className="pdash-btn pdash-btn-primary"
                style={{ width: '100%' }}
                onClick={onOpenSchedule}
              >
                {t('portal.rail.book.cta')}
              </button>
            </div>
          )}

          <div
            className="pdash-card cph-mini"
            style={locked ? { opacity: 0.45, pointerEvents: 'none' } : undefined}
          >
            <h3>{t('portal.messages.label')}</h3>
            {home.messagesPreview.length === 0 ? (
              <p className="text-muted text-sm">{t('portal.messages.empty')}</p>
            ) : (
              home.messagesPreview.map((msg, i) => (
                <button
                  type="button"
                  key={i}
                  className="cph-msg"
                  onClick={() => onOpenMatter(msg.matterEntityId)}
                >
                  <span className="cph-msg-av" aria-hidden>
                    {msg.author === 'attorney' ? 'PL' : t('portal.messages.you').slice(0, 2)}
                  </span>
                  <span className="cph-msg-body">
                    <span className="cph-msg-from">
                      {msg.author === 'attorney' ? 'Pacheco Law' : t('portal.messages.you')}
                    </span>
                    <span className="cph-msg-snip">
                      {msg.body.length > 90 ? `${msg.body.slice(0, 90)}…` : msg.body}
                    </span>
                  </span>
                </button>
              ))
            )}
            {home.messagesPreview.length > 0 && (
              <button
                type="button"
                className="cph-link"
                onClick={() => onOpenMatter(home.messagesPreview[0]!.matterEntityId)}
              >
                {t('portal.messages.open')}
              </button>
            )}
          </div>

          <div className="pdash-card cph-mini">
            <h3>{t('portal.billing.label')}</h3>
            {home.billing.dueCount === 0 ? (
              <p className="text-muted text-sm">{t('portal.billing.clear')}</p>
            ) : (
              <>
                <div className="cph-bill-amt">
                  {formatMoney(home.billing.dueTotal, home.billing.currency)}
                </div>
                <div className="cph-bill-sub">
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
                  className="pdash-btn pdash-btn-primary"
                  style={{ width: '100%' }}
                  onClick={onOpenBilling}
                >
                  {t('portal.billing.cta')}
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </>
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
  const [accepted, setAccepted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{
      status: { accepted: boolean }
      config: { rate: string | null; termsText: string | null; configured: boolean }
    }>({ toolName: 'legal.client.engagement' })
      .then((r) => setTerms(r.config.termsText))
      .catch(() => setTerms(null))
  }, [])

  async function confirm() {
    if (!accepted || busy) return
    setBusy(true)
    setError(null)
    try {
      await callClientPortalMcp({ toolName: 'legal.client.engagement_accept' })
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
      className="cph-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={t('portal.gate.terms_title')}
    >
      <div className="cph-modal">
        <h2>{t('portal.gate.terms_title')}</h2>
        {!configured ? (
          <p className="text-muted">{t('portal.gate.unavailable')}</p>
        ) : (
          <>
            {terms && <div className="cph-terms">{terms}</div>}
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
        <div className="cph-modal-actions">
          <button type="button" className="pdash-btn" onClick={onClose} disabled={busy}>
            {t('portal.gate.cancel')}
          </button>
          {configured && (
            <button
              type="button"
              className="pdash-btn pdash-btn-primary"
              disabled={!accepted || busy}
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

// ── Notifications (WP-3) ─────────────────────────────────────────────────────

function NotificationsView({
  onBadge,
  onOpenMatter,
  onOpenBilling,
  onOpenDocuments,
}: {
  onBadge: (n: number) => void
  onOpenMatter: (id: string) => void
  onOpenBilling: () => void
  onOpenDocuments: () => void
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
      onOpenDocuments()
      return
    }
    if (item.matterEntityId) {
      onOpenMatter(item.matterEntityId)
      return
    }
    if (item.type === 'invoice') onOpenBilling()
  }

  return (
    <section className="pdash-card">
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        {t('portal.notif.title')}
      </h3>
      {items === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : items.length === 0 ? (
        <p className="text-muted">{t('portal.notif.empty')}</p>
      ) : (
        <ul className="cph-notifs">
          {items.map((item) => (
            <li key={item.id}>
              <button type="button" className="cph-notif" onClick={() => open(item)}>
                {item.unread && <span className="cph-notif-dot" aria-hidden />}
                <span className="cph-notif-body">
                  <span className="cph-notif-label">
                    {t(`portal.notif.${item.type}`, { ref: item.ref ?? '' })}
                  </span>
                  <span className="cph-notif-meta">
                    {item.matterNumber ? `${item.matterNumber} · ` : ''}
                    {formatDateTime(item.occurredAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Documents (WP-4) — global view, grouped per matter, search per matter ───

const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt'
const INLINE_VIEW_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])

function DocumentsView({ matters }: { matters: MatterListItem[] }) {
  const { t } = useI18n()
  const [esign, setEsign] = useState<ClientDocument[] | null>(null)
  const [approved, setApproved] = useState<ApprovedDocument[] | null>(null)
  const [uploads, setUploads] = useState<UploadedDocument[] | null>(null)
  const [search, setSearch] = useState<Record<string, string>>({})
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const loadUploads = useCallback(() => {
    callClientPortalMcp<{ documents: UploadedDocument[] }>({ toolName: 'legal.client.uploads' })
      .then((r) => setUploads(r.documents))
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

  async function onFile(matterEntityId: string, e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
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
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : String(err))
    } finally {
      setUploadingFor(null)
    }
  }

  const loading = esign === null || approved === null || uploads === null

  // Group STRICTLY by the matter each document is attached to in the ledger —
  // the cross-matter render defect was the old view fetching client-wide lists
  // and captioning them with whatever matter was selected.
  const groups = matters.map((m) => {
    const q = (search[m.matterEntityId] ?? '').trim().toLowerCase()
    const match = (s: string | null | undefined) => !q || (s ?? '').toLowerCase().includes(q)
    return {
      matter: m,
      approved: (approved ?? []).filter(
        (d) => d.matterEntityId === m.matterEntityId && match(humanizeKind(d.documentKind)),
      ),
      esign: (esign ?? []).filter(
        (d) => d.matterEntityId === m.matterEntityId && match(d.documentTitle),
      ),
      uploads: (uploads ?? []).filter(
        (d) => d.matterEntityId === m.matterEntityId && match(d.originalFilename),
      ),
    }
  })

  return (
    <>
      <h1 className="cph-greeting">{t('portal.docs.title')}</h1>
      {uploadErr && (
        <div className="alert alert-error" role="alert">
          {uploadErr}
        </div>
      )}
      {loading ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> {t('portal.loading', undefined, 'Loading…')}
        </div>
      ) : (
        groups.map(({ matter, approved: appr, esign: sign, uploads: ups }) => {
          const q = (search[matter.matterEntityId] ?? '').trim()
          const empty = appr.length === 0 && sign.length === 0 && ups.length === 0
          return (
            <section className="pdash-card cph-docgroup" key={matter.matterEntityId}>
              <div className="cph-docgroup-head">
                <div>
                  <div className="cph-matter-title">
                    {matter.serviceLabel ?? matter.matterNumber}
                  </div>
                  <div className="cph-matter-meta">
                    {formatOpened(matter.openedAt)} · {matter.matterNumber}
                  </div>
                </div>
                <div className="cph-docgroup-tools">
                  <input
                    type="search"
                    className="pdash-input cph-doc-search"
                    placeholder={t('portal.docs.search')}
                    value={search[matter.matterEntityId] ?? ''}
                    onChange={(e) =>
                      setSearch((prev) => ({ ...prev, [matter.matterEntityId]: e.target.value }))
                    }
                  />
                  <label
                    className={`pdash-btn pdash-btn-sm ${uploadingFor === matter.matterEntityId ? 'is-disabled' : ''}`}
                  >
                    {uploadingFor === matter.matterEntityId
                      ? t('portal.docs.uploading')
                      : t('portal.docs.upload')}
                    <input
                      type="file"
                      accept={UPLOAD_ACCEPT}
                      onChange={(e) => onFile(matter.matterEntityId, e)}
                      disabled={uploadingFor !== null}
                      style={{ display: 'none' }}
                    />
                  </label>
                </div>
              </div>

              {empty ? (
                <p className="text-muted">
                  {q ? t('portal.docs.none_match') : t('portal.docs.empty')}
                </p>
              ) : (
                <>
                  {appr.length > 0 && (
                    <>
                      <h4 className="pdash-subhead">{t('portal.docs.from_attorney')}</h4>
                      <ul className="pdash-docs">
                        {appr.map((d) => (
                          <li key={d.documentVersionId} className="pdash-doc">
                            <div>
                              <div className="pdash-doc-title">{humanizeKind(d.documentKind)}</div>
                              <span className="text-sm text-muted">{formatDate(d.approvedAt)}</span>
                            </div>
                            <a
                              className="pdash-btn pdash-btn-sm"
                              href={`/d/${d.documentVersionId}`}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {t('portal.docs.view')}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {sign.length > 0 && (
                    <>
                      <h4 className="pdash-subhead">{t('portal.docs.to_sign')}</h4>
                      <ul className="pdash-docs">
                        {sign.map((d) => (
                          <li key={d.requestId} className="pdash-doc">
                            <div>
                              <div className="pdash-doc-title">
                                {d.documentTitle ?? t('portal.docs.title')}
                              </div>
                              <DocStateBadge state={d.state} />
                            </div>
                            {d.state === 'awaiting_you' ? (
                              <a
                                className="pdash-btn pdash-btn-sm"
                                href={`/portal/sign/${d.requestId}`}
                              >
                                {t('portal.attention.sign')}
                              </a>
                            ) : (
                              <a
                                className="pdash-btn pdash-btn-sm"
                                href={`/portal/sign/${d.requestId}`}
                              >
                                {t('portal.docs.view')}
                              </a>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {ups.length > 0 && (
                    <>
                      <h4 className="pdash-subhead">{t('portal.docs.uploaded')}</h4>
                      <ul className="pdash-docs">
                        {ups.map((u) => {
                          const mime = (u.contentType ?? '').toLowerCase().split(';')[0]?.trim()
                          const canInline = INLINE_VIEW_MIMES.has(mime ?? '')
                          return (
                            <li key={u.documentVersionId} className="pdash-doc">
                              <div>
                                <div className="pdash-doc-title">{u.originalFilename}</div>
                                <span className="text-sm text-muted">
                                  {formatBytes(u.sizeBytes)} · {formatDate(u.uploadedAt)}
                                </span>
                              </div>
                              <div style={{ display: 'flex', gap: 8 }}>
                                {canInline && (
                                  <a
                                    className="pdash-btn pdash-btn-sm"
                                    href={`/api/client/portal/documents/${u.documentVersionId}/content`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    {t('portal.docs.view')}
                                  </a>
                                )}
                                <a
                                  className="pdash-btn pdash-btn-sm"
                                  href={`/api/client/portal/documents/${u.documentVersionId}/content?download=1`}
                                >
                                  {t('portal.docs.download')}
                                </a>
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </>
              )}
            </section>
          )
        })
      )}
    </>
  )
}

// ── Matter detail — the existing per-matter view, reached from a home row ───

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
          <section className="pdash-card">
            <div className="pdash-card-head">
              <h2>
                {matter?.serviceLabel
                  ? `${matter.serviceLabel} · ${timeline.matterNumber}`
                  : timeline.matterNumber}
              </h2>
              <span className="pdash-badge">{timeline.statusLabel}</span>
            </div>
            {timeline.milestones.length === 0 ? (
              <p className="text-muted">{t('portal.notif.empty')}</p>
            ) : (
              <ol className="pdash-timeline">
                {timeline.milestones.map((m, i) => (
                  <li key={`${m.key}-${i}`}>
                    <span className="pdash-dot" aria-hidden />
                    <div>
                      <div>{m.label}</div>
                      <div className="text-sm text-muted">{formatDate(m.occurredAt)}</div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {locked ? (
        <section className="pdash-card cph-gate" style={{ marginTop: 'var(--space-3)' }}>
          <h3>{t('portal.gate.title')}</h3>
          <p>{t('portal.gate.body')}</p>
          <button type="button" className="pdash-btn pdash-btn-primary" onClick={onOpenGate}>
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

// Upcoming consultation with a self-service reschedule/cancel link (the same
// token-gated /book/manage page the confirmation email uses).
function UpcomingEventCard({ timeline }: { timeline: Timeline }) {
  const { t } = useI18n()
  const whenDate = timeline.scheduledAt ? parseTimestamp(timeline.scheduledAt) : null
  const when = whenDate
    ? whenDate.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'short' })
    : null
  return (
    <section className="pdash-card pdash-upcoming">
      <div>
        <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
          {t('portal.attention.consultation')}
        </h3>
        <div className="pdash-when">{when}</div>
      </div>
      {timeline.canManageEvent && timeline.manageUrl && (
        <a className="pdash-btn" href={timeline.manageUrl}>
          {t('portal.attention.manage')}
        </a>
      )}
    </section>
  )
}

// ── Billing (unchanged panel, reached from the home billing card) ───────────

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

function InvoicesPanel() {
  const [invoices, setInvoices] = useState<ClientInvoice[] | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ invoices: ClientInvoice[] }>({ toolName: 'legal.client.invoices' })
      .then((r) => setInvoices(r.invoices))
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

  return (
    <section className="pdash-card">
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        Invoices
      </h3>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {invoices === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading invoices…
        </div>
      ) : invoices.length === 0 ? (
        <p className="text-muted">
          No invoices yet. They&apos;ll appear here once the firm sends one.
        </p>
      ) : (
        <ul className="pdash-docs">
          {invoices.map((inv) => (
            <li key={inv.invoiceEntityId} className="pdash-doc">
              <div>
                <div className="pdash-doc-title">
                  {inv.invoiceNumber} · {formatMoney(inv.total, inv.currency)}
                </div>
                <span
                  className={`pdash-badge-sm ${
                    inv.status === 'paid' ? 'pdash-badge-ok' : 'pdash-badge-warn'
                  }`}
                >
                  {inv.status === 'paid' ? 'Paid' : 'Due'}
                </span>
                {inv.dueDate && inv.status !== 'paid' && (
                  <span className="text-sm text-muted" style={{ marginLeft: 'var(--space-2)' }}>
                    due {formatDate(inv.dueDate)}
                  </span>
                )}
              </div>
              <a
                className="pdash-btn pdash-btn-sm"
                href={`/portal/pay/${encodeURIComponent(inv.invoiceNumber)}`}
              >
                View
              </a>
            </li>
          ))}
        </ul>
      )}

      {billing &&
        (billing.matters.some((m) => m.accrued.length > 0) ||
          Number(billing.totals.running) > 0) && (
          <>
            <h3 className="pdash-subhead">Accruing fees (not yet invoiced)</h3>
            {billing.matters.filter((m) => m.accrued.length > 0).length === 0 ? (
              <p className="text-muted">No fees accruing right now.</p>
            ) : (
              billing.matters
                .filter((m) => m.accrued.length > 0)
                .map((m) => (
                  <div key={m.matterEntityId} style={{ marginBottom: 'var(--space-3)' }}>
                    <div className="pdash-doc-title">Matter {m.matterNumber}</div>
                    <ul className="pdash-docs">
                      {m.accrued.map((e, i) => (
                        <li key={i} className="pdash-doc">
                          <div>
                            <div>{e.description}</div>
                            {e.date && (
                              <span className="text-sm text-muted">{formatDate(e.date)}</span>
                            )}
                          </div>
                          <strong>{formatMoney(e.amount, billing.currency)}</strong>
                        </li>
                      ))}
                    </ul>
                    <div className="text-sm" style={{ textAlign: 'right' }}>
                      Accrued: <strong>{formatMoney(m.accruedTotal, billing.currency)}</strong>
                      {' · '}Running total (open + accrued):{' '}
                      <strong>{formatMoney(m.runningTotal, billing.currency)}</strong>
                    </div>
                  </div>
                ))
            )}
            <div
              className="pdash-doc-title"
              style={{ textAlign: 'right', marginTop: 'var(--space-2)' }}
            >
              Total open {formatMoney(billing.totals.due, billing.currency)} · accrued{' '}
              {formatMoney(billing.totals.accrued, billing.currency)} · running{' '}
              <strong>{formatMoney(billing.totals.running, billing.currency)}</strong>
            </div>
          </>
        )}
    </section>
  )
}

// ── Schedule (reached from the home Book CTA) ────────────────────────────────
// PORTAL-1 (WP4) — book another service (prefilled /book) + schedule time on the
// firm's real availability. The fee consent renders through the ONE shared
// FeeConsentCard (no inline fork).
function SchedulePanel() {
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
        setError('Please review and accept the fee below, then confirm again.')
        return
      }
      if (r.result) {
        setNotice(
          `Booked for ${new Date(r.result.startIso).toLocaleString()} — a calendar invitation and confirmation email are on the way.`,
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
      <section className="pdash-card" style={{ marginBottom: 'var(--space-3)' }}>
        <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
          {t('portal.rail.book.title')}
        </h3>
        <p className="text-muted">
          Book another service — signed in, your details and previous answers are prefilled.
        </p>
        <a className="pdash-btn" href="/book">
          Book a service
        </a>
      </section>

      <section className="pdash-card">
        <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
          Schedule time with the firm
        </h3>
        {notice && <div className="alert">{notice}</div>}
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}
        {availability === null ? (
          <div className="loading-block" role="status">
            <span className="spinner" /> Checking availability…
          </div>
        ) : !availability.configured ? (
          <p className="text-muted">
            Online scheduling isn&apos;t available right now — message the firm and they&apos;ll
            find a time with you.
          </p>
        ) : (
          <>
            {availability.meetingLengthsMinutes.length > 1 && (
              <label
                className="text-sm"
                style={{ display: 'block', marginBottom: 'var(--space-2)' }}
              >
                Length{' '}
                <select
                  value={duration ?? availability.durationMinutes}
                  onChange={(e) => setDuration(Number(e.target.value))}
                >
                  {availability.meetingLengthsMinutes.map((m) => (
                    <option key={m} value={m}>
                      {m} min
                    </option>
                  ))}
                </select>
              </label>
            )}
            {availability.slots.length === 0 ? (
              <p className="text-muted">No open times in the next few weeks.</p>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 8,
                  marginBottom: 'var(--space-2)',
                }}
              >
                {availability.slots.slice(0, 24).map((slot) => (
                  <button
                    key={slot.startIso}
                    className={`pdash-btn pdash-btn-sm ${selectedSlot?.startIso === slot.startIso ? 'pdash-btn-primary' : ''}`}
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
              className="pdash-btn pdash-btn-primary"
              disabled={!selectedSlot || busy || (Boolean(quote) && !feeAccepted)}
              onClick={book}
            >
              {busy ? 'Booking…' : 'Confirm time'}
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

  // Re-quote whenever the inputs that affect price change; clears a stale quote.
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
    <section className="pdash-card">
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        Make a request
      </h3>
      <p className="text-muted" style={{ marginTop: 0 }}>
        Request a meeting, a document, or an attorney review. You&apos;ll see the cost and accept it
        before it&apos;s submitted.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      <div className="cauth-form" style={{ maxWidth: 460 }}>
        <label className="cauth-label" htmlFor="req-type">
          What do you need?
        </label>
        <select
          id="req-type"
          className="cauth-input"
          value={type}
          onChange={(e) => setType(e.target.value as RequestType)}
        >
          <option value="meeting">Meeting</option>
          <option value="document">Document</option>
          <option value="review">Attorney review</option>
        </select>

        {type === 'meeting' && (
          <>
            <label className="cauth-label" htmlFor="req-dur">
              How long?
            </label>
            <select
              id="req-dur"
              className="cauth-input"
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
            </select>
          </>
        )}

        <label className="cauth-label" htmlFor="req-desc">
          Details (optional)
        </label>
        <textarea
          id="req-desc"
          className="cauth-input"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Tell the attorney what you need…"
        />

        {!quote ? (
          <button type="button" className="cauth-primary" disabled={busy} onClick={getQuote}>
            {busy ? 'Getting price…' : 'See the cost'}
          </button>
        ) : (
          <div className="alert" style={{ marginTop: 'var(--space-2)' }}>
            <div>
              <strong>{formatMoney(quote.amount, quote.currency)}</strong> — {quote.basis}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button type="button" className="cauth-primary" disabled={busy} onClick={accept}>
                {busy ? 'Submitting…' : 'Accept & submit'}
              </button>
              <button
                type="button"
                className="cauth-link"
                disabled={busy}
                onClick={() => setQuote(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {requests && requests.length > 0 && (
        <>
          <h3 className="pdash-subhead">Your requests</h3>
          <ul className="pdash-docs">
            {requests.map((r) => (
              <li key={r.requestEntityId} className="pdash-doc">
                <div>
                  <div className="pdash-doc-title">
                    {REQUEST_TYPE_LABEL[r.requestType] ?? r.requestType} ·{' '}
                    {formatMoney(r.amount, r.currency)}
                  </div>
                  <span className="pdash-badge-sm pdash-badge-muted">
                    {REQUEST_STATUS_LABEL[r.status] ?? r.status}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function DocStateBadge({ state }: { state: ClientDocument['state'] }) {
  const map = {
    awaiting_you: { label: 'Awaiting your signature', cls: 'pdash-badge-warn' },
    signed: { label: 'Signed', cls: 'pdash-badge-ok' },
    declined: { label: 'Declined', cls: 'pdash-badge-muted' },
    in_progress: { label: 'In progress', cls: 'pdash-badge-muted' },
  }[state]
  return <span className={`pdash-badge-sm ${map.cls}`}>{map.label}</span>
}

// Two-way messaging with the attorney for the selected matter.
function MessagesPanel({ matterEntityId }: { matterEntityId: string }) {
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
    <section className="pdash-card">
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        Messages
      </h3>
      <p className="text-sm text-muted" style={{ marginTop: 'calc(-1 * var(--space-1))' }}>
        Message your attorney about this matter.
      </p>

      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {messages === null ? (
        <div className="loading-block" role="status" style={{ marginTop: 'var(--space-3)' }}>
          <span className="spinner" /> Loading messages…
        </div>
      ) : messages.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
          No messages yet. Start the conversation below.
        </p>
      ) : (
        <div className="pdash-thread" role="log" aria-live="polite" aria-label="Messages">
          {messages.map((m, i) => (
            <div
              key={`${m.sentAt}-${i}`}
              className={`pdash-msg ${m.author === 'client' ? 'pdash-msg-me' : ''}`}
            >
              <div className="pdash-msg-body">{m.body}</div>
              <div className="pdash-msg-meta">
                {m.author === 'client' ? 'You' : 'Pacheco Law'} · {formatDateTime(m.sentAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="pdash-compose">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Write a message…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
        />
        <button className="pdash-btn" onClick={send} disabled={busy || !draft.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  )
}

// ── Assistant (WP-7) — floating bubble, gated per client ─────────────────────

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

function AssistantBubble() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  return (
    <div className="cph-assistant">
      {open && (
        <div className="cph-assistant-panel">
          <AssistantPanel />
        </div>
      )}
      {!open && <span className="cph-assistant-tag">{t('portal.assistant.tag')}</span>}
      <button
        type="button"
        className="cph-assistant-bubble"
        aria-label={t('portal.assistant.title')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2"
            strokeLinecap="round"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        ) : (
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 11.5a8.4 8.4 0 0 1-8.5 8.5 8.7 8.7 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.4 8.4 0 0 1 21 11.5z" />
          </svg>
        )}
      </button>
    </div>
  )
}

// PORTAL-1 (WP5) — the portal chatbot: streams over the client-scoped tool
// surface; a request needing the client's consent renders as a card whose
// button — the client's OWN click — files the cost-accepted request.
function AssistantPanel() {
  const { t } = useI18n()
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [card, setCard] = useState<RequestCard | null>(null)
  const [cardBusy, setCardBusy] = useState(false)
  const [cardDone, setCardDone] = useState<string | null>(null)

  async function send() {
    const message = input.trim()
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
      setCardDone('Request filed — the firm has been notified and will review it.')
    } catch (e) {
      setCardDone(e instanceof Error ? e.message : String(e))
    } finally {
      setCardBusy(false)
    }
  }

  return (
    <section className="pdash-card" style={{ margin: 0 }}>
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        {t('portal.assistant.title')}
      </h3>
      <p className="text-muted text-sm">
        Ask about your matters, documents, invoices, or scheduling. For legal questions the
        assistant will route you to the attorney — it doesn&apos;t give legal advice.
      </p>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          margin: 'var(--space-3) 0',
          maxHeight: 320,
          overflowY: 'auto',
        }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 12,
              background: m.role === 'user' ? 'var(--navy, #1e3a8a)' : 'var(--surface-2, #f1f5f9)',
              color: m.role === 'user' ? '#fff' : 'inherit',
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content || (busy && i === messages.length - 1 ? '…' : '')}
          </div>
        ))}
      </div>
      {card && (
        <div className="alert" role="note">
          <strong>Confirm your request</strong>
          <div style={{ margin: '6px 0' }}>
            {card.prefill.description}
            <br />
            Fee: <strong>${card.quote.amount}</strong>{' '}
            <span className="text-muted">({card.quote.basis})</span>
          </div>
          <button
            className="pdash-btn pdash-btn-primary"
            disabled={cardBusy}
            onClick={confirmRequest}
          >
            {cardBusy ? 'Filing…' : 'Accept fee & file request'}
          </button>
        </div>
      )}
      {cardDone && <div className="alert">{cardDone}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="pdash-input"
          style={{ flex: 1 }}
          value={input}
          placeholder="Ask the assistant…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <button
          className="pdash-btn pdash-btn-primary"
          disabled={busy || !input.trim()}
          onClick={() => void send()}
        >
          {busy ? '…' : 'Send'}
        </button>
      </div>
    </section>
  )
}
