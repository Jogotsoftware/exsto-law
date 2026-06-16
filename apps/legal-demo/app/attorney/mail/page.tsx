'use client'

// Mail tab (WP7, REQ-CALMAIL-02/03): client-related Gmail only — read, reply,
// compose in-app through the attorney's real account. Opening a thread also
// ingests it (mail.ingest, idempotent) so each matter carries its
// communication history. Gmail read scope is requested incrementally on first
// use (REQ-AUTH-03).
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { fetchSession } from '@/lib/auth'
import { PageHead } from '@/components/PageHead'

interface ThreadSummary {
  gmailThreadId: string
  subject: string
  snippet: string
  lastAt: string | null
  participantEmails: string[]
  messageCount: number
  matters: Array<{ matterEntityId: string; matterNumber: string }>
}

interface ThreadMessage {
  gmailMessageId: string
  from: string
  to: string
  sentAt: string | null
  bodyText: string
}

interface ThreadView {
  gmailThreadId: string
  subject: string
  participantEmails: string[]
  messages: ThreadMessage[]
  matters: Array<{ matterEntityId: string; matterNumber: string }>
}

export default function MailPage() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [open, setOpen] = useState<ThreadView | null>(null)
  const [reply, setReply] = useState('')
  const [compose, setCompose] = useState<{ to: string; subject: string; body: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsMailScope, setNeedsMailScope] = useState(false)
  const [sentNote, setSentNote] = useState<string | null>(null)

  async function load() {
    setError(null)
    setNeedsMailScope(false)
    try {
      const res = await callAttorneyMcp<{ threads: ThreadSummary[]; clientEmailCount: number }>({
        toolName: 'legal.mail.threads',
        input: {},
      })
      setThreads(res.threads)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('MAIL_SCOPE_MISSING')) {
        setNeedsMailScope(true)
      } else {
        setError(msg)
      }
      setThreads([])
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function openThread(gmailThreadId: string) {
    setBusy('open')
    setError(null)
    try {
      const view = await callAttorneyMcp<ThreadView>({
        toolName: 'legal.mail.thread_get',
        input: { gmailThreadId },
      })
      setOpen(view)
      setReply('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function sendReply() {
    if (!open || !reply.trim()) return
    setBusy('reply')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.mail.reply',
        input: { gmailThreadId: open.gmailThreadId, bodyText: reply },
      })
      setSentNote('Reply sent from your Gmail and recorded on the matter.')
      setTimeout(() => setSentNote(null), 6000)
      await openThread(open.gmailThreadId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function sendCompose() {
    if (!compose) return
    setBusy('compose')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.mail.compose',
        input: { to: compose.to, subject: compose.subject, bodyText: compose.body },
      })
      setCompose(null)
      setSentNote('Email sent from your Gmail and recorded.')
      setTimeout(() => setSentNote(null), 6000)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Mail/calendar OAuth modes REQUIRE tenant_id (the init route 400s without it).
  // Pull it from the verified session, exactly like the Settings "Connect Google"
  // button — the old static <a> link omitted tenant_id (and used returnTo instead
  // of the route's return_to), so "Enable Mail access" always failed.
  async function enableMail() {
    const session = await fetchSession()
    if (!session) {
      setError('Sign in first, then enable Mail.')
      return
    }
    const params = new URLSearchParams({
      mode: 'mail',
      tenant_id: session.tenantId,
      return_to: '/attorney/mail',
    })
    window.location.href = `/api/auth/google/init?${params.toString()}`
  }

  return (
    <main>
      <PageHead
        title="Mail"
        description="Client-related email only — replies go out through your real Gmail and land on the matter."
      />
      {needsMailScope && (
        <div className="alert">
          <strong>Enable Mail.</strong> Reading client threads needs one extra Gmail permission
          (asked only now, not at sign-in).{' '}
          <button className="primary" style={{ marginLeft: 'var(--space-2)' }} onClick={enableMail}>
            Enable Mail access
          </button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {sentNote && <div className="alert">{sentNote}</div>}

      <section>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Client threads</h2>
          <button onClick={() => setCompose({ to: '', subject: '', body: '' })}>Compose</button>
        </div>

        {compose && (
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              padding: 'var(--space-3)',
              marginTop: 'var(--space-3)',
            }}
          >
            <div className="row" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              <label>
                To (client email)
                <br />
                <input
                  type="email"
                  value={compose.to}
                  onChange={(e) => setCompose({ ...compose, to: e.target.value })}
                />
              </label>
              <label style={{ flex: 1 }}>
                Subject
                <br />
                <input
                  type="text"
                  style={{ width: '100%' }}
                  value={compose.subject}
                  onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
                />
              </label>
            </div>
            <textarea
              rows={5}
              style={{ width: '100%', marginTop: 'var(--space-2)' }}
              value={compose.body}
              onChange={(e) => setCompose({ ...compose, body: e.target.value })}
              placeholder="Only known client contacts are accepted — the send is refused otherwise."
            />
            <div className="row" style={{ gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
              <button
                className="primary"
                disabled={busy !== null || !compose.to || !compose.subject || !compose.body}
                onClick={sendCompose}
              >
                {busy === 'compose' ? 'Sending…' : 'Send from my Gmail'}
              </button>
              <button onClick={() => setCompose(null)}>Discard</button>
            </div>
          </div>
        )}

        {threads === null ? (
          <div className="loading-block">
            <span className="spinner" /> Loading client threads…
          </div>
        ) : threads.length === 0 && !needsMailScope ? (
          <p className="text-muted">
            No client-related threads found (only mail involving known matter contacts is shown).
          </p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 'var(--space-3)' }}>
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Matter</th>
                  <th>Last activity</th>
                  <th>Messages</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((t) => (
                  <tr
                    key={t.gmailThreadId}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openThread(t.gmailThreadId)}
                  >
                    <td>
                      <strong>{t.subject}</strong>
                      <div className="text-muted text-sm">{t.snippet.slice(0, 90)}</div>
                    </td>
                    <td>
                      {t.matters.map((m) => (
                        <Link
                          key={m.matterEntityId}
                          href={`/attorney/matters/${m.matterEntityId}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {m.matterNumber}
                        </Link>
                      ))}
                    </td>
                    <td>{t.lastAt ? new Date(t.lastAt).toLocaleString() : '—'}</td>
                    <td>{t.messageCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {open && (
        <section>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>{open.subject}</h2>
            <button onClick={() => setOpen(null)}>Close</button>
          </div>
          <p className="text-muted text-sm">
            {open.participantEmails.join(', ')}
            {open.matters.length > 0 && (
              <>
                {' · '}
                {open.matters.map((m) => (
                  <Link key={m.matterEntityId} href={`/attorney/matters/${m.matterEntityId}`}>
                    {m.matterNumber}
                  </Link>
                ))}
              </>
            )}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {open.messages.map((m) => (
              <div
                key={m.gmailMessageId}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: 'var(--space-3)',
                }}
              >
                <div className="text-sm">
                  <strong>{m.from}</strong> → {m.to}
                  <span className="text-muted">
                    {' '}
                    · {m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}
                  </span>
                </div>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontFamily: 'inherit',
                    margin: 'var(--space-2) 0 0',
                  }}
                >
                  {m.bodyText.trim()}
                </pre>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 'var(--space-3)' }}>
            <textarea
              rows={4}
              style={{ width: '100%' }}
              placeholder="Reply to the client…"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
            />
            <button
              className="primary"
              style={{ marginTop: 'var(--space-2)' }}
              disabled={busy !== null || !reply.trim()}
              onClick={sendReply}
            >
              {busy === 'reply' ? 'Sending…' : 'Reply from my Gmail'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
