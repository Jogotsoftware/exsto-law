'use client'

import { useCallback, useEffect, useState } from 'react'
import { ScaleIcon } from '@/components/icons'
import { callClientPortalMcp, PortalSessionExpiredError } from '@/lib/mcpClientPortal'

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
  scheduledAt: string | null
  canManageEvent: boolean
  manageUrl: string | null
  milestones: Milestone[]
}
interface ClientDocument {
  requestId: string
  envelopeId: string
  documentTitle: string | null
  state: 'awaiting_you' | 'signed' | 'declined' | 'in_progress'
  rawStatus: string
}
interface ApprovedDocument {
  documentVersionId: string
  documentKind: string
  matterNumber: string
  versionNumber: number
  approvedAt: string
}
interface UploadedDocument {
  documentVersionId: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  matterNumber: string
  uploadedAt: string
}

function humanizeKind(kind: string): string {
  return kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
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

type Tab = 'matters' | 'documents' | 'billing' | 'messages'
const TABS: { key: Tab; label: string }[] = [
  { key: 'matters', label: 'Matters' },
  { key: 'documents', label: 'Documents' },
  { key: 'billing', label: 'Billing' },
  { key: 'messages', label: 'Messages & Requests' },
]

// Signed-in client portal — a tabbed shell (header + nav + wide content) over the
// client's matters, documents, billing, and messaging/requests. All identity comes
// from the httpOnly cookie; this page sends no identity (the server derives it).
export default function ClientPortalPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [matters, setMatters] = useState<MatterListItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [tab, setTab] = useState<Tab>('matters')
  const [error, setError] = useState<string | null>(null)

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

  useEffect(() => {
    if (!me) return
    callClientPortalMcp<{ matters: MatterListItem[] }>({ toolName: 'legal.client.matters' })
      .then((r) => {
        setMatters(r.matters)
        if (r.matters.length > 0) setSelected(r.matters[0]!.matterEntityId)
      })
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [me])

  useEffect(() => {
    if (!selected) return
    setTimeline(null)
    callClientPortalMcp<{ timeline: Timeline | null }>({
      toolName: 'legal.client.matter_timeline',
      input: { matterEntityId: selected },
    })
      .then((r) => setTimeline(r.timeline))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [selected])

  const matterScoped = tab === 'matters' || tab === 'messages' || tab === 'documents'

  return (
    <div className="cp-shell">
      <header className="cp-top">
        <div className="cp-top-inner">
          <div className="cp-brand">
            <span className="cp-crest" aria-hidden>
              <ScaleIcon size={18} />
            </span>
            <span className="cp-brand-text">
              <span className="cp-brand-name">Pacheco Law</span>
              <span className="cp-brand-sub">Client Portal</span>
            </span>
          </div>
          <div className="cp-top-right">
            {me && (
              <span className="cp-who" title={me.email}>
                {me.displayName}
              </span>
            )}
            <a href="/api/client/auth/logout" className="cp-signout">
              Sign out
            </a>
          </div>
        </div>
        <nav className="cp-nav" aria-label="Portal sections">
          <div className="cp-nav-inner">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`cp-tab ${tab === t.key ? 'active' : ''}`}
                aria-current={tab === t.key ? 'page' : undefined}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="cp-main">
        {error && (
          <div className="alert alert-error" role="alert">
            {error}
          </div>
        )}

        {!me || !matters ? (
          <div className="loading-block" role="status">
            <span className="spinner" /> Loading…
          </div>
        ) : matters.length === 0 ? (
          <div className="pdash-card pdash-empty">
            You don&apos;t have any matters with the firm yet. Once you book a consultation,
            it&apos;ll appear here.
          </div>
        ) : (
          <>
            {matterScoped && matters.length > 1 && (
              <div className="cp-switch">
                <label htmlFor="matter-switch">Matter</label>
                <select
                  id="matter-switch"
                  value={selected ?? ''}
                  onChange={(e) => setSelected(e.target.value)}
                >
                  {matters.map((m) => (
                    <option key={m.matterEntityId} value={m.matterEntityId}>
                      {m.matterNumber} — {m.statusLabel}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {tab === 'matters' &&
              (!timeline ? (
                <div className="loading-block" role="status">
                  <span className="spinner" /> Loading matter…
                </div>
              ) : (
                <>
                  {timeline.scheduledAt && <UpcomingEventCard timeline={timeline} />}
                  <section className="pdash-card">
                    <div className="pdash-card-head">
                      <h2>Matter {timeline.matterNumber}</h2>
                      <span className="pdash-badge">{timeline.statusLabel}</span>
                    </div>
                    <h3 className="pdash-subhead">Timeline</h3>
                    {timeline.milestones.length === 0 ? (
                      <p className="text-muted">No updates yet.</p>
                    ) : (
                      <ol className="pdash-timeline">
                        {timeline.milestones.map((m, i) => (
                          <li key={`${m.key}-${i}`}>
                            <span className="pdash-dot" aria-hidden />
                            <div>
                              <div>{m.label}</div>
                              <div className="text-sm text-muted">
                                {new Date(m.occurredAt).toLocaleDateString()}
                              </div>
                            </div>
                          </li>
                        ))}
                      </ol>
                    )}
                  </section>
                </>
              ))}

            {tab === 'documents' && <DocumentsPanel matterEntityId={selected} />}
            {tab === 'billing' && <InvoicesPanel />}
            {tab === 'messages' &&
              (selected ? (
                <>
                  <RequestsPanel matterEntityId={selected} />
                  <MessagesPanel matterEntityId={selected} />
                </>
              ) : (
                <p className="text-muted">Select a matter to message the firm.</p>
              ))}
          </>
        )}
      </main>
    </div>
  )
}

// Upcoming consultation with a self-service reschedule/cancel link (the same
// token-gated /book/manage page the confirmation email uses).
function UpcomingEventCard({ timeline }: { timeline: Timeline }) {
  const when = timeline.scheduledAt
    ? new Date(timeline.scheduledAt).toLocaleString(undefined, {
        dateStyle: 'full',
        timeStyle: 'short',
      })
    : null
  return (
    <section className="pdash-card pdash-upcoming">
      <div>
        <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
          {timeline.canManageEvent ? 'Upcoming consultation' : 'Consultation'}
        </h3>
        <div className="pdash-when">{when}</div>
      </div>
      {timeline.canManageEvent && timeline.manageUrl && (
        <a className="pdash-btn" href={timeline.manageUrl}>
          Reschedule or cancel
        </a>
      )}
    </section>
  )
}

function formatBytes(n: number): string {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

const UPLOAD_ACCEPT = '.pdf,.doc,.docx,.png,.jpg,.jpeg,.tif,.tiff,.txt'

// All of the client's documents: approved by the attorney (read via the shared-draft
// page), e-sign documents (to-sign / signed), and documents the client uploads to
// the selected matter.
function DocumentsPanel({ matterEntityId }: { matterEntityId: string | null }) {
  const [docs, setDocs] = useState<ClientDocument[] | null>(null)
  const [approved, setApproved] = useState<ApprovedDocument[] | null>(null)
  const [uploads, setUploads] = useState<UploadedDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadErr, setUploadErr] = useState<string | null>(null)

  const loadUploads = useCallback(() => {
    callClientPortalMcp<{ documents: UploadedDocument[] }>({ toolName: 'legal.client.uploads' })
      .then((r) => setUploads(r.documents))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setUploads([])
      })
  }, [])

  useEffect(() => {
    callClientPortalMcp<{ documents: ClientDocument[] }>({
      toolName: 'legal.esign.portal.documents',
    })
      .then((r) => setDocs(r.documents))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
        setDocs([])
      })
    callClientPortalMcp<{ documents: ApprovedDocument[] }>({ toolName: 'legal.client.documents' })
      .then((r) => setApproved(r.documents))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setApproved([])
      })
    loadUploads()
  }, [loadUploads])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file || !matterEntityId) return
    setUploading(true)
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
      setUploading(false)
    }
  }

  const loading = docs === null || approved === null || uploads === null

  return (
    <section className="pdash-card">
      <h3 className="pdash-subhead" style={{ marginTop: 0 }}>
        Documents
      </h3>
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}

      {/* Upload */}
      <div style={{ margin: '0 0 var(--space-3)' }}>
        <label className={`pdash-btn pdash-btn-sm ${uploading || !matterEntityId ? 'is-disabled' : ''}`}>
          {uploading ? 'Uploading…' : 'Upload a document'}
          <input
            type="file"
            accept={UPLOAD_ACCEPT}
            onChange={onFile}
            disabled={uploading || !matterEntityId}
            style={{ display: 'none' }}
          />
        </label>
        <span className="text-sm text-muted" style={{ marginLeft: '0.6rem' }}>
          PDF, Word, images, or text · up to 25 MB
        </span>
        {uploadErr && (
          <div className="alert alert-error" role="alert" style={{ marginTop: '0.5rem' }}>
            {uploadErr}
          </div>
        )}
      </div>

      {loading ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading documents…
        </div>
      ) : (
        <>
          {approved && approved.length > 0 && (
            <>
              <h4 className="pdash-subhead" style={{ marginTop: 0 }}>
                From your attorney
              </h4>
              <ul className="pdash-docs">
                {approved.map((d) => (
                  <li key={d.documentVersionId} className="pdash-doc">
                    <div>
                      <div className="pdash-doc-title">{humanizeKind(d.documentKind)}</div>
                      <span className="text-sm text-muted">
                        {d.matterNumber} · approved {new Date(d.approvedAt).toLocaleDateString()}
                      </span>
                    </div>
                    <a
                      className="pdash-btn pdash-btn-sm"
                      href={`/d/${d.documentVersionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}

          {docs && docs.length > 0 && (
            <>
              <h4 className="pdash-subhead">To sign &amp; signed</h4>
              <ul className="pdash-docs">
                {docs.map((d) => (
                  <li key={d.requestId} className="pdash-doc">
                    <div>
                      <div className="pdash-doc-title">{d.documentTitle ?? 'Document'}</div>
                      <DocStateBadge state={d.state} />
                    </div>
                    {d.state === 'awaiting_you' && (
                      <a className="pdash-btn pdash-btn-sm" href={`/portal/sign/${d.requestId}`}>
                        Review &amp; sign
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}

          {uploads && uploads.length > 0 && (
            <>
              <h4 className="pdash-subhead">You&apos;ve uploaded</h4>
              <ul className="pdash-docs">
                {uploads.map((u) => (
                  <li key={u.documentVersionId} className="pdash-doc">
                    <div>
                      <div className="pdash-doc-title">{u.originalFilename}</div>
                      <span className="text-sm text-muted">
                        {u.matterNumber} · {formatBytes(u.sizeBytes)} · uploaded{' '}
                        {new Date(u.uploadedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}

          {approved &&
            approved.length === 0 &&
            docs &&
            docs.length === 0 &&
            uploads &&
            uploads.length === 0 && (
              <p className="text-muted">
                No documents yet. Upload one above, or we&apos;ll post documents here when
                they&apos;re ready.
              </p>
            )}
        </>
      )}
    </section>
  )
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

// All of the client's issued invoices, across matters. View-only for now; the
// detail/pay page (/portal/pay/<number>) is where online payment will land.
function InvoicesPanel() {
  const [invoices, setInvoices] = useState<ClientInvoice[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    callClientPortalMcp<{ invoices: ClientInvoice[] }>({ toolName: 'legal.client.invoices' })
      .then((r) => setInvoices(r.invoices))
      .catch((e) => {
        if (e instanceof PortalSessionExpiredError) return
        setError(e instanceof Error ? e.message : String(e))
        setInvoices([])
      })
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
                  <span className="text-sm text-muted" style={{ marginLeft: '0.5rem' }}>
                    due {new Date(inv.dueDate).toLocaleDateString()}
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
    </section>
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
            <div style={{ display: 'flex', gap: '0.6rem', marginTop: '0.6rem' }}>
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
                {m.author === 'client' ? 'You' : 'Pacheco Law'} ·{' '}
                {new Date(m.sentAt).toLocaleString()}
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
