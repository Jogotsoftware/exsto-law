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
  milestones: Milestone[]
}

interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
}

// Signed-in client portal. Read-only: a matter switcher (when the client has
// more than one matter), the current status, and a whitelisted milestone
// timeline. All identity comes from the httpOnly cookie; this page sends no
// identity — the server derives it.
export default function ClientPortalPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [matters, setMatters] = useState<MatterListItem[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [timeline, setTimeline] = useState<Timeline | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 1. Confirm we're signed in (display fields) — bounce to login on 401.
  useEffect(() => {
    fetch('/api/client/auth/me', { credentials: 'same-origin' })
      .then((res) => {
        if (res.status === 401) {
          window.location.href = '/portal/login'
          return null
        }
        return res.json()
      })
      .then((body: MeResponse | null) => {
        if (body) setMe(body)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])

  // 2. Load the client's matters once signed in.
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

  // 3. Load the selected matter's timeline.
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
      <main className="public-draft">
        <div className="alert alert-error">{error}</div>
      </main>
    )
  }

  if (!me || !matters) {
    return (
      <main className="public-draft">
        <div className="loading-block">
          <span className="spinner" /> Loading…
        </div>
      </main>
    )
  }

  return (
    <main className="public-draft">
      <div className="public-draft-head">
        <div>
          <div className="public-draft-firm">Pacheco Law</div>
          <h1 style={{ margin: 'var(--space-1) 0 0' }}>Your matters</h1>
          <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
            Signed in as {me.displayName} ({me.email})
          </div>
        </div>
        <div className="public-draft-actions">
          <a href="/api/client/auth/logout">Sign out</a>
        </div>
      </div>

      {matters.length === 0 ? (
        <p style={{ marginTop: 'var(--space-4)' }}>
          You don&apos;t have any matters with the firm yet.
        </p>
      ) : (
        <>
          {matters.length > 1 && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <label htmlFor="matter-switch" className="text-sm">
                Matter
              </label>
              <select
                id="matter-switch"
                value={selected ?? ''}
                onChange={(e) => setSelected(e.target.value)}
                style={{ display: 'block', marginTop: 'var(--space-1)' }}
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
            <div className="loading-block" style={{ marginTop: 'var(--space-4)' }}>
              <span className="spinner" /> Loading matter…
            </div>
          ) : (
            <section style={{ marginTop: 'var(--space-4)' }}>
              <h2 style={{ margin: 0 }}>Matter {timeline.matterNumber}</h2>
              <div className="text-sm" style={{ marginTop: 'var(--space-1)' }}>
                Status: <strong>{timeline.statusLabel}</strong>
              </div>
              {timeline.scheduledAt && (
                <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                  Consultation: {new Date(timeline.scheduledAt).toLocaleString()}
                </div>
              )}

              <h3 style={{ marginTop: 'var(--space-4)' }}>Timeline</h3>
              {timeline.milestones.length === 0 ? (
                <p className="text-muted">No updates yet.</p>
              ) : (
                <ol style={{ marginTop: 'var(--space-2)' }}>
                  {timeline.milestones.map((m, i) => (
                    <li key={`${m.key}-${i}`} style={{ marginBottom: 'var(--space-2)' }}>
                      <div>{m.label}</div>
                      <div className="text-sm text-muted">
                        {new Date(m.occurredAt).toLocaleDateString()}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}

          {selected && <MessagesPanel matterEntityId={selected} />}
        </>
      )}
    </main>
  )
}

// Two-way messaging with the attorney for the selected matter. Reads the thread
// (legal.client.thread_get) and posts (legal.client.message_post). Identity is
// the httpOnly cookie — this panel sends no identity; the server stamps the
// client_contact + asserts per-matter authorization before either call runs.
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
    <section style={{ marginTop: 'var(--space-4)' }}>
      <h3 style={{ margin: 0 }}>Messages</h3>
      <p className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
        Message your attorney about this matter.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {messages === null ? (
        <div className="loading-block" style={{ marginTop: 'var(--space-3)' }}>
          <span className="spinner" /> Loading messages…
        </div>
      ) : messages.length === 0 ? (
        <p className="text-muted" style={{ marginTop: 'var(--space-3)' }}>
          No messages yet. Start the conversation below.
        </p>
      ) : (
        <div
          style={{
            marginTop: 'var(--space-3)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
          }}
        >
          {messages.map((m, i) => (
            <div
              key={`${m.sentAt}-${i}`}
              style={{
                alignSelf: m.author === 'client' ? 'flex-end' : 'flex-start',
                maxWidth: '80%',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: '10px',
                background:
                  m.author === 'client' ? 'var(--accent-soft, #e0e7ff)' : 'var(--surface, #f4f4f5)',
                border: '1px solid var(--border)',
              }}
            >
              <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                {m.body}
              </div>
              <div className="text-sm text-muted" style={{ marginTop: 'var(--space-1)' }}>
                {m.author === 'client' ? 'You' : 'Pacheco Law'} ·{' '}
                {new Date(m.sentAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: 'var(--space-3)',
          display: 'flex',
          gap: 'var(--space-2)',
          alignItems: 'flex-start',
        }}
      >
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          placeholder="Write a message…"
          style={{ flex: 1 }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
        />
        <button className="primary" onClick={send} disabled={busy || !draft.trim()}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
    </section>
  )
}
