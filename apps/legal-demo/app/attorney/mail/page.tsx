'use client'

// Mail tab (WP7, REQ-CALMAIL-02): client-related Gmail only — read, reply,
// compose in-app through the attorney's real account. Opening a thread also
// ingests it (mail.ingest, idempotent) so each matter carries its
// communication history. Gmail read is granted as part of the single
// "Connect Google" consent in Settings (one connection = calendar + full email);
// the in-tab "Reconnect Google" button is only a fallback for legacy connections
// made before that consent was unified.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { fetchSession } from '@/lib/auth'
import { PageHead } from '@/components/PageHead'
import { MailComposer, type ComposerValue } from '@/components/MailComposer'
import { SignatureBlock, type FirmSignature } from '@/components/SignatureBlock'

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

// "Name <a@b.com>" → "Name"; bare "a@b.com" → "a@b.com". Used for the reading
// pane sender line where the From header may carry a display name.
function displayName(addr: string): string {
  const m = addr.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/)
  return (m ? m[1] : addr).trim() || addr.trim()
}

// Just the address part of "Name <a@b.com>" (or the string itself).
function bareEmail(addr: string): string {
  const m = addr.match(/<([^>]+)>/)
  return (m ? m[1] : addr).trim()
}

// Two-letter avatar initials from an email's local part ("ecorp.noreply" → "EN").
function emailInitials(addr: string): string {
  const local = (bareEmail(addr).split('@')[0] || addr).replace(/[._%+-]+/g, ' ').trim()
  const parts = local.split(' ').filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return (local.slice(0, 2) || '·').toUpperCase()
}

// Compact sender label for an inbox row: first address, then "+N more".
function senderLabel(emails: string[]): string {
  if (emails.length === 0) return '(unknown)'
  if (emails.length === 1) return emails[0]!
  return `${emails[0]} +${emails.length - 1}`
}

// Gmail-style date: time if today, "Mon D" this year, else "Mon D, YYYY".
function relativeDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(
    undefined,
    sameYear
      ? { month: 'short', day: 'numeric' }
      : { month: 'short', day: 'numeric', year: 'numeric' },
  )
}

const EMPTY_BODY: ComposerValue = { html: '', text: '' }

export default function MailPage() {
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  const [open, setOpen] = useState<ThreadView | null>(null)
  const [reply, setReply] = useState<ComposerValue>(EMPTY_BODY)
  const [compose, setCompose] = useState<{
    to: string
    subject: string
    body: ComposerValue
  } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [needsMailScope, setNeedsMailScope] = useState(false)
  const [sentNote, setSentNote] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [signature, setSignature] = useState<FirmSignature | null>(null)
  // Bumped after each send/discard so the uncontrolled composer remounts clean.
  const [composerNonce, setComposerNonce] = useState(0)

  async function load(search?: string) {
    setError(null)
    setNeedsMailScope(false)
    try {
      const res = await callAttorneyMcp<{ threads: ThreadSummary[]; clientEmailCount: number }>({
        toolName: 'legal.mail.threads',
        input: search && search.trim() ? { query: search.trim() } : {},
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
    // The firm signature the send path will append, shown (and editable) in the
    // composer so the attorney sees what gets added (it is appended server-side).
    callAttorneyMcp<{ signature: FirmSignature }>({
      toolName: 'legal.settings.signature.get',
    })
      .then((r) => setSignature(r.signature))
      .catch(() => setSignature(null))
  }, [])

  // Contract D — launchCompose: open the composer pre-wired from query params
  // (?compose=1&to=…|contactId=…&subject=…). A contactId is resolved to the
  // client's email; otherwise `to` is used directly.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('compose') !== '1') return
    const subject = params.get('subject') ?? ''
    const to = params.get('to') ?? ''
    const contactId = params.get('contactId')
    if (to || !contactId) {
      setCompose({ to, subject, body: EMPTY_BODY })
      return
    }
    callAttorneyMcp<{ contact: { email?: string } | null }>({
      toolName: 'legal.contact.get',
      input: { contactEntityId: contactId },
    })
      .then((r) => setCompose({ to: r.contact?.email ?? '', subject, body: EMPTY_BODY }))
      .catch(() => setCompose({ to: '', subject, body: EMPTY_BODY }))
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
      setReply(EMPTY_BODY)
      setComposerNonce((n) => n + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  async function sendReply() {
    if (!open || !reply.text.trim()) return
    setBusy('reply')
    setError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.mail.reply',
        input: {
          gmailThreadId: open.gmailThreadId,
          bodyText: reply.text,
          bodyHtml: reply.html || undefined,
        },
      })
      setReply(EMPTY_BODY)
      setComposerNonce((n) => n + 1)
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
        input: {
          to: compose.to,
          subject: compose.subject,
          bodyText: compose.body.text,
          bodyHtml: compose.body.html || undefined,
        },
      })
      setCompose(null)
      setComposerNonce((n) => n + 1)
      setSentNote('Email sent from your Gmail and recorded.')
      setTimeout(() => setSentNote(null), 6000)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  // Reconnect Google to grant email reading. One Google connection now covers
  // calendar + full email, so this is only a fallback for LEGACY connections made
  // before that change — it routes through the same full-scope connect (the init
  // route reads tenantId + actorId from the verified session cookie, per-attorney
  // migration 0016) and comes back with read + send + calendar all granted.
  async function reconnectGoogle() {
    const session = await fetchSession()
    if (!session) {
      setError('Sign in first, then reconnect Google.')
      return
    }
    const params = new URLSearchParams({
      mode: 'calendar',
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
          <strong>Reconnect Google.</strong> This Google connection was made before email reading
          was included. Reconnect once to grant it — a single connection now covers calendar and
          full email.{' '}
          <button
            className="primary"
            style={{ marginLeft: 'var(--space-2)' }}
            onClick={reconnectGoogle}
          >
            Reconnect Google
          </button>
        </div>
      )}
      {error && <div className="alert alert-error">{error}</div>}
      {sentNote && <div className="alert">{sentNote}</div>}

      <section>
        <div className="mail-toolbar">
          <form
            className="mail-search"
            onSubmit={(e) => {
              e.preventDefault()
              setThreads(null)
              load(query)
            }}
          >
            <input
              type="search"
              placeholder="Search client mail — words, subject:…, from:…, after:2026/01/01"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" disabled={busy !== null}>
              Search
            </button>
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('')
                  setThreads(null)
                  load()
                }}
              >
                Clear
              </button>
            )}
          </form>
          <button
            className="primary"
            onClick={() => setCompose({ to: '', subject: '', body: EMPTY_BODY })}
          >
            Compose
          </button>
        </div>

        {compose && (
          <div className="mail-compose-card">
            <div className="mail-compose-head">
              <strong>New message</strong>
              <button
                className="mail-icon-btn"
                onClick={() => setCompose(null)}
                aria-label="Discard"
              >
                ✕
              </button>
            </div>
            <label className="mail-field">
              <span className="mail-field-label">To</span>
              <input
                type="email"
                placeholder="client@example.com"
                value={compose.to}
                onChange={(e) => setCompose({ ...compose, to: e.target.value })}
              />
            </label>
            <label className="mail-field">
              <span className="mail-field-label">Subject</span>
              <input
                type="text"
                value={compose.subject}
                onChange={(e) => setCompose({ ...compose, subject: e.target.value })}
              />
            </label>
            <MailComposer
              key={`compose-${composerNonce}`}
              placeholder="Write your message… Only known client contacts are accepted."
              footer={<SignatureBlock value={signature} onChange={setSignature} />}
              onChange={(v) => setCompose((c) => (c ? { ...c, body: v } : c))}
            />
            <div className="mail-compose-actions">
              <button
                className="primary"
                disabled={
                  busy !== null || !compose.to || !compose.subject || !compose.body.text.trim()
                }
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
            <span className="spinner" /> Loading client mail…
          </div>
        ) : threads.length === 0 && !needsMailScope ? (
          <p className="text-muted">
            {query
              ? 'No client mail matches your search.'
              : 'No client-related threads found (only mail involving known matter contacts is shown).'}
          </p>
        ) : (
          <div className="mail-list">
            {threads.map((t) => (
              <div
                key={t.gmailThreadId}
                className={`mail-row ${open?.gmailThreadId === t.gmailThreadId ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => openThread(t.gmailThreadId)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    openThread(t.gmailThreadId)
                  }
                }}
              >
                <span className="mail-avatar" aria-hidden="true">
                  {emailInitials(t.participantEmails[0] ?? '?')}
                </span>
                <div className="mail-row-main">
                  <div className="mail-row-top">
                    <span className="mail-row-people">{senderLabel(t.participantEmails)}</span>
                    <span className="mail-row-date">{t.lastAt ? relativeDate(t.lastAt) : ''}</span>
                  </div>
                  <div className="mail-row-subject">
                    {t.subject}
                    {t.messageCount > 1 && <span className="mail-row-count">{t.messageCount}</span>}
                  </div>
                  <div className="mail-row-snippet">{t.snippet}</div>
                  {t.matters.length > 0 && (
                    <div className="mail-row-matters">
                      {t.matters.map((m) => (
                        <Link
                          key={m.matterEntityId}
                          href={`/attorney/matters/${m.matterEntityId}`}
                          className="badge info"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {m.matterNumber}
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {open && (
        <section className="mail-thread">
          <div className="mail-thread-head">
            <div>
              <h2 className="mail-thread-subject">{open.subject}</h2>
              <p className="mail-thread-meta">
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
            </div>
            <button className="mail-icon-btn" onClick={() => setOpen(null)} aria-label="Close">
              ✕
            </button>
          </div>

          <div className="mail-msgs">
            {open.messages.map((m) => (
              <article key={m.gmailMessageId} className="mail-msg">
                <span className="mail-avatar" aria-hidden="true">
                  {emailInitials(m.from)}
                </span>
                <div className="mail-msg-main">
                  <div className="mail-msg-head">
                    <span className="mail-msg-from" title={m.from}>
                      {displayName(m.from)}
                    </span>
                    <span className="mail-msg-date">
                      {m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}
                    </span>
                  </div>
                  <div className="mail-msg-to">to {m.to}</div>
                  <div className="mail-msg-body">{m.bodyText.trim()}</div>
                </div>
              </article>
            ))}
          </div>

          <div className="mail-reply">
            <div className="mail-reply-label">
              Reply to{' '}
              {open.participantEmails.length > 0 ? open.participantEmails[0] : 'the client'}
            </div>
            <MailComposer
              key={`reply-${open.gmailThreadId}-${composerNonce}`}
              placeholder="Reply to the client…"
              footer={<SignatureBlock value={signature} onChange={setSignature} />}
              onChange={setReply}
            />
            <button
              className="primary"
              style={{ marginTop: 'var(--space-2)' }}
              disabled={busy !== null || !reply.text.trim()}
              onClick={sendReply}
            >
              {busy === 'reply' ? 'Sending…' : 'Send reply'}
            </button>
          </div>
        </section>
      )}
    </main>
  )
}
