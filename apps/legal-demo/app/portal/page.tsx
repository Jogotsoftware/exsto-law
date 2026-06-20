'use client'

import { useCallback, useEffect, useState } from 'react'
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
interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}

// Signed-in client portal — one secure place for matters, upcoming events,
// documents, and attorney messaging. All identity comes from the httpOnly
// cookie; this page sends no identity (the server derives + authorizes it).
export default function ClientPortalPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [matters, setMatters] = useState<MatterListItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
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

  if (error) {
    return (
      <main className="pdash">
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      </main>
    )
  }
  if (!me || !matters) {
    return (
      <main className="pdash">
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )
  }

  return (
    <main className="pdash">
      <header className="pdash-head">
        <div>
          <div className="pdash-firm">Pacheco Law</div>
          <h1 className="pdash-title">Your client portal</h1>
          <div className="pdash-who">
            Signed in as {me.displayName} ({me.email})
          </div>
        </div>
        <a href="/api/client/auth/logout" className="pdash-signout">
          Sign out
        </a>
      </header>

      {matters.length === 0 ? (
        <div className="pdash-card pdash-empty">
          You don&apos;t have any matters with the firm yet. Once you book a consultation, it&apos;ll
          appear here.
        </div>
      ) : (
        <>
          {matters.length > 1 && (
            <div className="pdash-switch">
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

          {!timeline ? (
            <div className="loading-block" role="status" style={{ marginTop: 'var(--space-4)' }}>
              <span className="spinner" /> Loading matter…
            </div>
          ) : (
            <>
              {timeline.scheduledAt && (
                <UpcomingEventCard timeline={timeline} />
              )}

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
          )}

          <DocumentsPanel />
          {selected && <MessagesPanel matterEntityId={selected} />}
        </>
      )}
    </main>
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

// All of the client's documents (to-sign and already signed), across matters.
function DocumentsPanel() {
  const [docs, setDocs] = useState<ClientDocument[] | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  }, [])

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
      {docs === null ? (
        <div className="loading-block" role="status">
          <span className="spinner" /> Loading documents…
        </div>
      ) : docs.length === 0 ? (
        <p className="text-muted">No documents yet. We&apos;ll post them here when they&apos;re ready.</p>
      ) : (
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
                {m.author === 'client' ? 'You' : 'Pacheco Law'} · {new Date(m.sentAt).toLocaleString()}
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
