'use client'

// Mail tab (WP7 baseline + WP-I redesign): a two-pane inbox — Gmail client
// threads (read, reply, compose, matter attachments, signature) plus a Portal
// chat tab aggregating every matter's client↔attorney portal thread. Opening a
// Gmail thread also ingests it (mail.ingest, idempotent) and now clears
// Gmail's own UNREAD label (legal.mail.thread_get → markThreadRead), so the
// Email tab's unread badge is real Gmail read-state, not a heuristic. The
// Portal tab reuses the SAME tools the matter Activity tab already uses
// (legal.matter.thread_get / legal.matter.message_post) plus one new
// cross-matter read (legal.matter.portal_threads) — no parallel messaging
// path. Gmail read/send is granted as part of the single "Connect Google"
// consent in Settings; the in-tab "Reconnect Google" button is only a
// fallback for legacy connections made before that consent was unified.
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { callAttorneyMcp } from '@/lib/mcpAttorney'
import { fetchSession } from '@/lib/auth'
import { formatDateTime } from '@/lib/datetime'
import { MailComposer, type ComposerValue } from '@/components/MailComposer'
import { SignatureBlock, type FirmSignature } from '@/components/SignatureBlock'
import { Modal } from '@/components/Modal'
import { Tabs } from '@/components/Tabs'
import { AttachmentPicker, type PickedAttachment } from '@/components/mail/AttachmentPicker'
import { SearchIcon, SendIcon, FileTextIcon, PlusIcon } from '@/components/icons'

type MatterRef = { matterEntityId: string; matterNumber: string }

// Send a client email WITH attachments through the dedicated route (attachments
// can't ride the JSON MCP transport; the server resolves refs → bytes + scope).
async function sendWithAttachments(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/attorney/mail/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new Error(data?.error ?? 'Failed to send.')
}

interface ThreadSummary {
  gmailThreadId: string
  subject: string
  snippet: string
  lastAt: string | null
  participantEmails: string[]
  messageCount: number
  matters: MatterRef[]
  // email (lowercased, bare) → known client contact name.
  participantNames: Record<string, string>
  // Real Gmail read-state (WP-I): true while any message in the thread still
  // carries Gmail's UNREAD label.
  unread: boolean
}

interface ThreadMessage {
  gmailMessageId: string
  from: string
  to: string
  sentAt: string | null
  bodyText: string
  // The message's HTML part, when present — already allowlist-sanitized on the
  // server (sanitizeEmailHtml), so it's safe to render inline; formatting (bold,
  // lists, links, tables) is preserved. Absent for plaintext-only messages.
  bodyHtml?: string
}

interface ThreadView {
  gmailThreadId: string
  subject: string
  participantEmails: string[]
  messages: ThreadMessage[]
  matters: MatterRef[]
  participantNames: Record<string, string>
}

// WP-I — Portal chat tab types. Mirrors legal.matter.portal_threads /
// legal.matter.thread_get (the SAME PortalMessage shape the matter Activity
// tab's Messages card already reads).
interface PortalThreadSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  lastAuthor: 'client' | 'attorney' | null
  lastBody: string
  lastAt: string | null
  messageCount: number
  unreadCount: number
}
interface PortalMessage {
  author: 'client' | 'attorney'
  body: string
  sentAt: string
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

// Two-letter avatar initials from a person's full name ("Teo Marsh" → "TM"),
// for the Portal chat tab (whose rows are client_contact names, not emails).
function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
  if (parts.length === 1) return (parts[0]!.slice(0, 2) || '·').toUpperCase()
  return '·'
}

// Resolve an address to a known client contact name, falling back to the display
// name in the header, then the bare address.
function personLabel(addr: string, names: Record<string, string>): string {
  return names[bareEmail(addr).toLowerCase()] ?? displayName(addr)
}

// Compact sender label for an inbox row: first participant (name when known),
// then "+N more".
function senderLabel(emails: string[], names: Record<string, string>): string {
  if (emails.length === 0) return '(unknown)'
  const first = personLabel(emails[0]!, names)
  if (emails.length === 1) return first
  return `${first} +${emails.length - 1}`
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
type MailTab = 'email' | 'portal'

export default function MailPage() {
  const [tab, setTab] = useState<MailTab>('email')

  // ── Email tab state ──────────────────────────────────────────────────────
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null)
  // The full inbox's unread count, independent of a search filter's result set
  // (kept in step with `threads` only on unfiltered loads — see `load`).
  const [inboxUnread, setInboxUnread] = useState(0)
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
  // Attachment state (reply + compose). The matter is the attachment scope: for a
  // reply it's the thread's matter; for compose it's resolved from the recipient.
  const [replyAttach, setReplyAttach] = useState<PickedAttachment[]>([])
  const [replyMatterId, setReplyMatterId] = useState<string | null>(null)
  const [composeAttach, setComposeAttach] = useState<PickedAttachment[]>([])
  const [composeMatters, setComposeMatters] = useState<MatterRef[]>([])
  const [composeMatterId, setComposeMatterId] = useState<string | null>(null)

  // ── Portal chat tab state ────────────────────────────────────────────────
  const [portalThreads, setPortalThreads] = useState<PortalThreadSummary[] | null>(null)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [portalQuery, setPortalQuery] = useState('')
  const [openMatterId, setOpenMatterId] = useState<string | null>(null)
  const [portalMessages, setPortalMessages] = useState<PortalMessage[] | null>(null)
  const [portalDraft, setPortalDraft] = useState('')
  const [portalBusy, setPortalBusy] = useState(false)

  async function load(search?: string): Promise<ThreadSummary[]> {
    setError(null)
    setNeedsMailScope(false)
    try {
      const res = await callAttorneyMcp<{ threads: ThreadSummary[]; clientEmailCount: number }>({
        toolName: 'legal.mail.threads',
        input: search && search.trim() ? { query: search.trim() } : {},
      })
      setThreads(res.threads)
      // Only an unfiltered load reflects the whole inbox — a search's result set
      // must never make the tab badge look like the inbox emptied out.
      if (!search || !search.trim()) {
        setInboxUnread(res.threads.filter((t) => t.unread).length)
      }
      return res.threads
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('MAIL_SCOPE_MISSING')) {
        setNeedsMailScope(true)
      } else {
        setError(msg)
      }
      setThreads([])
      return []
    }
  }

  function loadPortalThreads(): Promise<PortalThreadSummary[]> {
    return callAttorneyMcp<{ threads: PortalThreadSummary[] }>({
      toolName: 'legal.matter.portal_threads',
    })
      .then((r) => {
        setPortalThreads(r.threads)
        return r.threads
      })
      .catch((err) => {
        setPortalError(err instanceof Error ? err.message : String(err))
        setPortalThreads([])
        return []
      })
  }

  useEffect(() => {
    // Honor a deep link into a specific Gmail thread (?thread=<id>, from the
    // matter Activity tab's Emails card) — skip auto-selecting the first row
    // when one is pending; the other mount effect below opens it.
    const hasThreadParam =
      typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('thread')
    load().then((res) => {
      if (!hasThreadParam && res.length > 0) openThread(res[0]!.gmailThreadId)
    })
    loadPortalThreads()
    // The firm signature the send path will append, shown (and editable) in the
    // composer so the attorney sees what gets added (it is appended server-side).
    callAttorneyMcp<{ signature: FirmSignature }>({
      toolName: 'legal.settings.signature.get',
    })
      .then((r) => setSignature(r.signature))
      .catch(() => setSignature(null))
  }, [])

  // Auto-select the first portal thread the first time the tab is actually
  // visited (lazy — no point opening a thread detail nobody has looked at).
  useEffect(() => {
    if (tab !== 'portal' || openMatterId || !portalThreads || portalThreads.length === 0) return
    openPortalThread(portalThreads[0]!.matterEntityId)
  }, [tab, portalThreads])

  // Contract D — launchCompose: open the composer pre-wired from query params
  // (?compose=1&to=…|contactId=…&subject=…). A contactId is resolved to the
  // client's email; otherwise `to` is used directly.
  //
  // WP-B2: a matter Documents-tab "Email" on an upload adds
  // &attachKind=upload&attachId=<versionId>&attachLabel=<filename>&matterId=<id>
  // — pre-selects that upload in the SAME AttachmentPicker state a manual pick
  // would set (composeAttach/composeMatterId), reusing the existing attach +
  // send path rather than a new one.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('compose') !== '1') return
    const subject = params.get('subject') ?? ''
    const to = params.get('to') ?? ''
    const contactId = params.get('contactId')
    const attachKind = params.get('attachKind')
    const attachId = params.get('attachId')
    const matterIdParam = params.get('matterId')
    if (attachKind === 'upload' && attachId) {
      setComposeAttach([
        { kind: 'upload', id: attachId, label: params.get('attachLabel') || 'Attached file' },
      ])
    }
    if (matterIdParam) setComposeMatterId(matterIdParam)
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

  // Deep-link into a specific thread (?thread=<gmailThreadId>) — the matter
  // Activity tab's Emails card (WP-B2) opens rows this way.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const threadId = new URLSearchParams(window.location.search).get('thread')
    if (threadId) void openThread(threadId)
  }, [])

  // Resolve which matters the compose recipient is a client of, so the attachment
  // picker can scope to one of them. Debounced lightly on the typed address.
  const composeTo = compose?.to ?? ''
  useEffect(() => {
    const email = composeTo.trim()
    if (!email.includes('@')) {
      setComposeMatters([])
      setComposeMatterId(null)
      return
    }
    let cancelled = false
    const t = setTimeout(() => {
      callAttorneyMcp<{ matters: MatterRef[] }>({
        toolName: 'legal.mail.recipient_matters',
        input: { email },
      })
        .then((r) => {
          if (cancelled) return
          setComposeMatters(r.matters)
          setComposeMatterId((prev) =>
            prev && r.matters.some((m) => m.matterEntityId === prev)
              ? prev
              : (r.matters[0]?.matterEntityId ?? null),
          )
        })
        .catch(() => {
          if (!cancelled) setComposeMatters([])
        })
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [composeTo])

  async function openThread(gmailThreadId: string) {
    setBusy('open')
    setError(null)
    const wasUnread = threads?.find((t) => t.gmailThreadId === gmailThreadId)?.unread ?? false
    try {
      const view = await callAttorneyMcp<ThreadView>({
        toolName: 'legal.mail.thread_get',
        input: { gmailThreadId },
      })
      setOpen(view)
      setReply(EMPTY_BODY)
      setReplyAttach([])
      setReplyMatterId(view.matters[0]?.matterEntityId ?? null)
      setComposerNonce((n) => n + 1)
      // Opening ingests + marks the thread read server-side (legal.mail.thread_get
      // → markThreadRead); clear the row's dot to match without a full reload.
      setThreads((prev) =>
        prev
          ? prev.map((t) => (t.gmailThreadId === gmailThreadId ? { ...t, unread: false } : t))
          : prev,
      )
      if (wasUnread) setInboxUnread((n) => Math.max(0, n - 1))
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
      if (replyAttach.length > 0) {
        if (!replyMatterId) throw new Error('Pick a matter for the attachments.')
        await sendWithAttachments({
          mode: 'reply',
          gmailThreadId: open.gmailThreadId,
          bodyText: reply.text,
          bodyHtml: reply.html || undefined,
          matterId: replyMatterId,
          attachments: replyAttach.map(({ kind, id }) => ({ kind, id })),
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.mail.reply',
          input: {
            gmailThreadId: open.gmailThreadId,
            bodyText: reply.text,
            bodyHtml: reply.html || undefined,
          },
        })
      }
      setReply(EMPTY_BODY)
      setReplyAttach([])
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
      if (composeAttach.length > 0) {
        if (!composeMatterId) throw new Error('Pick a matter for the attachments.')
        await sendWithAttachments({
          mode: 'compose',
          to: compose.to,
          subject: compose.subject,
          bodyText: compose.body.text,
          bodyHtml: compose.body.html || undefined,
          matterId: composeMatterId,
          attachments: composeAttach.map(({ kind, id }) => ({ kind, id })),
        })
      } else {
        await callAttorneyMcp({
          toolName: 'legal.mail.compose',
          input: {
            to: compose.to,
            subject: compose.subject,
            bodyText: compose.body.text,
            bodyHtml: compose.body.html || undefined,
          },
        })
      }
      setCompose(null)
      setComposeAttach([])
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

  async function openPortalThread(matterEntityId: string) {
    setOpenMatterId(matterEntityId)
    setPortalMessages(null)
    setPortalError(null)
    try {
      const r = await callAttorneyMcp<{ messages: PortalMessage[] }>({
        toolName: 'legal.matter.thread_get',
        input: { matterEntityId },
      })
      setPortalMessages(r.messages)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : String(err))
      setPortalMessages([])
    }
  }

  async function sendPortalReply() {
    if (!openMatterId || !portalDraft.trim() || portalBusy) return
    setPortalBusy(true)
    setPortalError(null)
    try {
      await callAttorneyMcp({
        toolName: 'legal.matter.message_post',
        input: { matterEntityId: openMatterId, body: portalDraft.trim() },
      })
      setPortalDraft('')
      const [msgs] = await Promise.all([
        callAttorneyMcp<{ messages: PortalMessage[] }>({
          toolName: 'legal.matter.thread_get',
          input: { matterEntityId: openMatterId },
        }),
        loadPortalThreads(),
      ])
      setPortalMessages(msgs.messages)
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : String(err))
    } finally {
      setPortalBusy(false)
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

  const portalUnreadTabCount = portalThreads?.filter((t) => t.unreadCount > 0).length ?? 0
  const trimmedPortalQuery = portalQuery.trim().toLowerCase()
  const filteredPortalThreads = portalThreads
    ? trimmedPortalQuery
      ? portalThreads.filter(
          (t) =>
            t.matterNumber.toLowerCase().includes(trimmedPortalQuery) ||
            t.clientName.toLowerCase().includes(trimmedPortalQuery) ||
            t.lastBody.toLowerCase().includes(trimmedPortalQuery),
        )
      : portalThreads
    : null
  const currentPortalMeta = portalThreads?.find((t) => t.matterEntityId === openMatterId) ?? null

  return (
    <main>
      <div className="li-mail-head">
        <h1 className="li-mail-title">Inbox</h1>
        {tab === 'email' && (
          <button
            type="button"
            className="li-mail-composebtn"
            onClick={() => setCompose({ to: '', subject: '', body: EMPTY_BODY })}
          >
            <PlusIcon size={15} />
            Compose
          </button>
        )}
      </div>

      {tab === 'email' && needsMailScope && (
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
      {portalError && <div className="alert alert-error">{portalError}</div>}
      {sentNote && <div className="alert">{sentNote}</div>}

      <Tabs
        ariaLabel="Mail"
        tabs={[
          { key: 'email', label: 'Email', badge: inboxUnread },
          { key: 'portal', label: 'Portal chat', badge: portalUnreadTabCount },
        ]}
        active={tab}
        onSelect={(k) => setTab(k as MailTab)}
      />

      <div className="li-mail-grid">
        {tab === 'email' ? (
          <>
            <div className="li-mail-listpane">
              <div className="li-mail-searchwrap">
                <form
                  className="li-mail-searchbox"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setThreads(null)
                    load(query)
                  }}
                >
                  <SearchIcon size={15} />
                  <input
                    type="search"
                    placeholder="Search email…"
                    value={query}
                    onChange={(e) => {
                      const v = e.target.value
                      const wasFiltered = query.trim().length > 0
                      setQuery(v)
                      if (!v.trim() && wasFiltered) {
                        setThreads(null)
                        load()
                      }
                    }}
                  />
                </form>
              </div>
              <div className="li-mail-rows">
                {threads === null ? (
                  <div className="li-mail-loading">
                    <span className="spinner" /> Loading client mail…
                  </div>
                ) : threads.length === 0 ? (
                  <div className="li-mail-empty">
                    {query
                      ? `No conversations match "${query}".`
                      : needsMailScope
                        ? 'Reconnect Google to see client mail.'
                        : 'No client-related threads found (only mail involving known matter contacts is shown).'}
                  </div>
                ) : (
                  threads.map((t) => (
                    <button
                      key={t.gmailThreadId}
                      type="button"
                      className={`li-mail-row ${open?.gmailThreadId === t.gmailThreadId ? 'is-active' : ''} ${t.unread ? 'is-unread' : ''}`}
                      onClick={() => openThread(t.gmailThreadId)}
                    >
                      <span className="li-mail-row-avatar" aria-hidden="true">
                        {emailInitials(t.participantEmails[0] ?? '?')}
                      </span>
                      <span className="li-mail-row-main">
                        <span className="li-mail-row-top">
                          <span className="li-mail-row-name">
                            {senderLabel(t.participantEmails, t.participantNames)}
                          </span>
                          <span className="li-mail-row-time">
                            {t.lastAt ? relativeDate(t.lastAt) : ''}
                          </span>
                          {t.unread && <span className="li-mail-row-dot" aria-label="Unread" />}
                        </span>
                        <span className="li-mail-row-subject">
                          {t.subject || '(no subject)'}
                          {t.messageCount > 1 && (
                            <span className="li-mail-row-subject-count">{t.messageCount}</span>
                          )}
                        </span>
                        <span className="li-mail-row-preview">{t.snippet}</span>
                        {t.matters[0] && (
                          <Link
                            href={`/attorney/matters/${t.matters[0].matterEntityId}`}
                            className="li-mail-row-matter"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {t.matters[0].matterNumber}
                          </Link>
                        )}
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="li-mail-detailpane">
              {!open ? (
                <div className="li-mail-detailplaceholder">
                  {busy === 'open' ? 'Opening…' : 'Select a conversation.'}
                </div>
              ) : (
                <>
                  <div className="li-mail-detailhead">
                    <span className="li-mail-detailhead-avatar" aria-hidden="true">
                      {emailInitials(open.participantEmails[0] ?? '?')}
                    </span>
                    <div className="li-mail-detailhead-main">
                      <div className="li-mail-detailhead-subject">
                        {open.subject || '(no subject)'}
                      </div>
                      <div className="li-mail-detailhead-sub">
                        {open.participantEmails
                          .map((e) => personLabel(e, open.participantNames))
                          .join(', ')}
                      </div>
                    </div>
                    {open.matters[0] && (
                      <Link
                        href={`/attorney/matters/${open.matters[0].matterEntityId}`}
                        className="li-mail-detailhead-btn"
                        title={`Open ${open.matters[0].matterNumber}`}
                        aria-label={`Open matter ${open.matters[0].matterNumber}`}
                      >
                        <FileTextIcon size={17} />
                      </Link>
                    )}
                  </div>

                  <div className="li-mail-body">
                    {open.messages.map((m) => (
                      <article key={m.gmailMessageId} className="li-mail-msgcard">
                        <div className="li-mail-msgcard-head">
                          <span className="li-mail-msgcard-avatar" aria-hidden="true">
                            {emailInitials(m.from)}
                          </span>
                          <div className="li-mail-msgcard-main">
                            <div className="li-mail-msgcard-toprow">
                              <span className="li-mail-msgcard-who" title={m.from}>
                                {personLabel(m.from, open.participantNames)}{' '}
                                <span className="li-mail-msgcard-addr">
                                  &lt;{bareEmail(m.from)}&gt;
                                </span>
                              </span>
                              <span className="li-mail-msgcard-when">
                                {m.sentAt ? new Date(m.sentAt).toLocaleString() : ''}
                              </span>
                            </div>
                            <div className="li-mail-msgcard-to" title={m.to}>
                              to {personLabel(m.to, open.participantNames)}
                            </div>
                          </div>
                        </div>
                        {/* The HTML body is already allowlist-sanitized server-side
                            (sanitizeEmailHtml), so rendering it directly is safe and
                            keeps natural formatting; plaintext-only messages fall back. */}
                        {m.bodyHtml ? (
                          <div
                            className="li-mail-msgcard-body li-mail-msgcard-body-html"
                            dangerouslySetInnerHTML={{ __html: m.bodyHtml }}
                          />
                        ) : (
                          <div className="li-mail-msgcard-body">{m.bodyText.trim()}</div>
                        )}
                      </article>
                    ))}
                  </div>

                  <div className="li-mail-replywrap">
                    <div className="li-mail-replylabel">
                      Reply to{' '}
                      {open.participantEmails.length > 0
                        ? personLabel(open.participantEmails[0]!, open.participantNames)
                        : 'the client'}
                    </div>
                    <MailComposer
                      key={`reply-${open.gmailThreadId}-${composerNonce}`}
                      placeholder="Reply to the client…"
                      footer={<SignatureBlock value={signature} onChange={setSignature} />}
                      onChange={setReply}
                    />
                    {open.matters.length > 0 && (
                      <AttachmentPicker
                        matterId={replyMatterId}
                        matterOptions={open.matters}
                        value={replyAttach}
                        onChange={setReplyAttach}
                        onMatterChange={(id) => {
                          setReplyMatterId(id)
                          setReplyAttach([])
                        }}
                      />
                    )}
                    <div className="li-mail-replysendrow">
                      <button
                        type="button"
                        className="li-mail-replysendbtn"
                        disabled={busy !== null || !reply.text.trim()}
                        onClick={sendReply}
                      >
                        <SendIcon size={15} />
                        {busy === 'reply' ? 'Sending…' : 'Send reply'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="li-mail-listpane">
              <div className="li-mail-searchwrap">
                <div className="li-mail-searchbox">
                  <SearchIcon size={15} />
                  <input
                    type="search"
                    placeholder="Search portal chat…"
                    value={portalQuery}
                    onChange={(e) => setPortalQuery(e.target.value)}
                  />
                </div>
              </div>
              <div className="li-mail-rows">
                {portalThreads === null ? (
                  <div className="li-mail-loading">
                    <span className="spinner" /> Loading portal chat…
                  </div>
                ) : filteredPortalThreads && filteredPortalThreads.length === 0 ? (
                  <div className="li-mail-empty">
                    {portalQuery
                      ? `No conversations match "${portalQuery}".`
                      : 'No client messages yet.'}
                  </div>
                ) : (
                  filteredPortalThreads?.map((t) => (
                    <button
                      key={t.matterEntityId}
                      type="button"
                      className={`li-mail-row ${openMatterId === t.matterEntityId ? 'is-active' : ''} ${t.unreadCount > 0 ? 'is-unread' : ''}`}
                      onClick={() => openPortalThread(t.matterEntityId)}
                    >
                      <span className="li-mail-row-avatar" aria-hidden="true">
                        {nameInitials(t.clientName || t.matterNumber)}
                      </span>
                      <span className="li-mail-row-main">
                        <span className="li-mail-row-top">
                          <span className="li-mail-row-name">{t.clientName || t.matterNumber}</span>
                          <span className="li-mail-row-time">
                            {t.lastAt ? relativeDate(t.lastAt) : ''}
                          </span>
                          {t.unreadCount > 0 && (
                            <span className="li-mail-row-dot" aria-label="Unread" />
                          )}
                        </span>
                        <span className="li-mail-row-subject">{t.matterNumber}</span>
                        <span className="li-mail-row-preview">
                          {t.lastAuthor === 'attorney' ? 'You: ' : ''}
                          {t.lastBody}
                        </span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            </div>

            <div className="li-mail-detailpane">
              {!openMatterId ? (
                <div className="li-mail-detailplaceholder">Select a conversation.</div>
              ) : (
                <>
                  <div className="li-mail-detailhead">
                    <span className="li-mail-detailhead-avatar" aria-hidden="true">
                      {nameInitials(
                        currentPortalMeta?.clientName || currentPortalMeta?.matterNumber || '?',
                      )}
                    </span>
                    <div className="li-mail-detailhead-main">
                      <div className="li-mail-detailhead-subject">
                        {currentPortalMeta?.clientName ||
                          currentPortalMeta?.matterNumber ||
                          'Portal chat'}
                      </div>
                      <div className="li-mail-detailhead-sub">
                        {currentPortalMeta?.matterNumber}
                      </div>
                    </div>
                    <Link
                      href={`/attorney/matters/${openMatterId}`}
                      className="li-mail-detailhead-btn"
                      title="Open matter"
                      aria-label="Open matter"
                    >
                      <FileTextIcon size={17} />
                    </Link>
                  </div>

                  <div className="li-mail-pbubbles">
                    {portalMessages === null ? (
                      <div className="li-mail-loading">
                        <span className="spinner" /> Loading…
                      </div>
                    ) : portalMessages.length === 0 ? (
                      <div className="li-mail-empty">No messages yet.</div>
                    ) : (
                      portalMessages.map((m, i) => (
                        <div
                          key={`${m.sentAt}-${i}`}
                          className={`li-mail-pbubblerow ${m.author === 'attorney' ? 'is-attorney' : 'is-client'}`}
                        >
                          <div className="li-mail-pbubble-meta">
                            {m.author === 'attorney'
                              ? 'You'
                              : currentPortalMeta?.clientName || 'Client'}
                            {' · '}
                            {formatDateTime(m.sentAt)}
                          </div>
                          <div className="li-mail-pbubble">{m.body}</div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="li-mail-replywrap">
                    <div className="li-mail-portalreplybar">
                      <textarea
                        rows={1}
                        className="li-mail-portalreplytextarea"
                        placeholder="Reply to the client…"
                        value={portalDraft}
                        onChange={(e) => setPortalDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendPortalReply()
                        }}
                      />
                      <button
                        type="button"
                        className="li-mail-portalsendbtn"
                        aria-label="Send"
                        disabled={portalBusy || !portalDraft.trim()}
                        onClick={sendPortalReply}
                      >
                        <SendIcon size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {compose && (
        <Modal
          title="New message"
          onClose={() => setCompose(null)}
          footer={
            <>
              <button onClick={() => setCompose(null)}>Discard</button>
              <button
                className="primary"
                disabled={
                  busy !== null || !compose.to || !compose.subject || !compose.body.text.trim()
                }
                onClick={sendCompose}
              >
                {busy === 'compose' ? 'Sending…' : 'Send from my Gmail'}
              </button>
            </>
          }
        >
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
          {composeMatters.length > 0 && (
            <AttachmentPicker
              matterId={composeMatterId}
              matterOptions={composeMatters}
              value={composeAttach}
              onChange={setComposeAttach}
              onMatterChange={(id) => {
                setComposeMatterId(id)
                setComposeAttach([]) // documents are matter-scoped; reset on switch
              }}
            />
          )}
        </Modal>
      )}
    </main>
  )
}
