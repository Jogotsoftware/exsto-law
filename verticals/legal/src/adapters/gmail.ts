import { google, type gmail_v1 } from 'googleapis'
import {
  buildOAuthClient,
  loadCredentials,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
  GMAIL_MODIFY_SCOPE,
} from './googleCalendar.js'
import { sanitizeEmailHtml } from './sanitizeEmailHtml.js'

// Firm sender identity for all outbound client mail (WP3.1 acceptance). Quoted
// because the name contains "(beta)" — parentheses are comment delimiters in
// RFC 5322 headers, so an unquoted display name would be misparsed.
export const FIRM_SENDER_DISPLAY_NAME = 'Pacheco Law - Legal Instruments (beta)'

export interface EmailAttachment {
  filename: string
  contentType: string
  // Raw bytes, base64-encoded (callers pass e.g. a rendered PDF/Word doc).
  contentBase64: string
}

export interface SendEmailArgs {
  to: string
  // Optional Cc recipients (comma-separated, RFC 5322 address-list). Policy note:
  // Contract B (enqueueClientEmail) restricts Cc to FIRM STAFF — validation lives
  // there, not here; this adapter just writes the header.
  cc?: string
  subject: string
  body: string
  // Optional branded HTML alternative. When present the message body becomes a
  // multipart/alternative (text/plain `body` + this text/html), so clients render
  // the HTML while `body` stays the plaintext fallback. Plaintext is ALWAYS sent.
  html?: string
  // Reply support (WP7 Mail tab): thread the message into an existing Gmail
  // conversation.
  gmailThreadId?: string
  inReplyToMessageIdHeader?: string
  // Optional file attachments (Contract B). When present the message is built as
  // multipart/mixed; otherwise it stays a single text/plain (or /alternative) part.
  attachments?: EmailAttachment[]
}

export interface SendEmailResult {
  messageId: string
  from: string
  to: string
}

// base64 wrapped at 76 columns per RFC 2045 for attachment parts.
function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, '$1\r\n')
}

interface InlineImage {
  cid: string
  contentType: string
  contentBase64: string
}

// Rich signatures / composer bodies embed photos as data: URLs. Gmail (and most
// clients) refuse to display data: images in received mail, so at the MIME
// boundary they become proper inline parts: each data URL is swapped for a
// cid: reference and the bytes ride along in a multipart/related wrapper.
function extractInlineImages(html: string, seed: string): { html: string; images: InlineImage[] } {
  const images: InlineImage[] = []
  const out = html.replace(
    /src="data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)"/gi,
    (_m, contentType: string, b64: string) => {
      const cid = `img${images.length + 1}.${seed}@exsto`
      images.push({ cid, contentType, contentBase64: b64 })
      return `src="cid:${cid}"`
    },
  )
  return { html: out, images }
}

// Build the raw RFC 5322 message, base64url-encoded for the Gmail send API.
// Four shapes, composed from one body section + an optional attachment wrapper:
//   plain only                  → text/plain
//   plain + html                → multipart/alternative
//   plain + attachments         → multipart/mixed[ text/plain, …att ]
//   plain + html + attachments  → multipart/mixed[ multipart/alternative, …att ]
function buildRawMessage(args: SendEmailArgs, fromHeader: string): string {
  const headers = [
    `To: ${args.to}`,
    `From: ${fromHeader}`,
    `Subject: ${encodeHeaderIfNeeded(args.subject)}`,
  ]
  if (args.cc?.trim()) {
    // Sanitize at the MIME boundary regardless of upstream (same discipline as
    // attachment filenames): strip CR/LF so a crafted value can't smuggle extra
    // headers (e.g. an injected Bcc) into the raw message.
    headers.splice(1, 0, `Cc: ${args.cc.replace(/[\r\n]+/g, ' ').trim()}`)
  }
  if (args.inReplyToMessageIdHeader) {
    headers.push(`In-Reply-To: ${args.inReplyToMessageIdHeader}`)
    headers.push(`References: ${args.inReplyToMessageIdHeader}`)
  }
  const seed = Buffer.from(`${args.to}:${args.subject}`).toString('hex').slice(0, 24)

  // The body section: a bare text/plain, or a multipart/alternative (plaintext +
  // HTML) when an html part is supplied. Embedded data: images in the HTML are
  // lifted into a multipart/related wrapper around the html part (cid parts), so
  // photos in signatures/bodies actually display in recipients' clients. Returns
  // its own Content-Type header line(s) so it can sit at the top level OR be
  // nested inside multipart/mixed.
  function bodySection(): { typeLines: string[]; lines: string[] } {
    if (args.html) {
      const { html, images } = extractInlineImages(args.html, seed)
      const altB = `=_exsto_alt_${seed}`
      const htmlLines = [
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: 8bit',
        '',
        html,
      ]
      const htmlPart: string[] = []
      if (images.length > 0) {
        const relB = `=_exsto_rel_${seed}`
        htmlPart.push(
          `Content-Type: multipart/related; boundary="${relB}"`,
          '',
          `--${relB}`,
          ...htmlLines,
        )
        for (const img of images) {
          htmlPart.push(
            `--${relB}`,
            `Content-Type: ${img.contentType}`,
            'Content-Transfer-Encoding: base64',
            `Content-ID: <${img.cid}>`,
            'Content-Disposition: inline',
            '',
            wrap76(img.contentBase64),
          )
        }
        htmlPart.push(`--${relB}--`)
      } else {
        htmlPart.push(...htmlLines)
      }
      return {
        typeLines: [`Content-Type: multipart/alternative; boundary="${altB}"`],
        lines: [
          `--${altB}`,
          'Content-Type: text/plain; charset="UTF-8"',
          'Content-Transfer-Encoding: 8bit',
          '',
          args.body,
          `--${altB}`,
          ...htmlPart,
          `--${altB}--`,
        ],
      }
    }
    return {
      typeLines: ['Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: 8bit'],
      lines: [args.body],
    }
  }

  const body = bodySection()
  let mime: string
  if (args.attachments && args.attachments.length > 0) {
    const mixB = `=_exsto_mix_${seed}`
    const parts: string[] = [`--${mixB}`, ...body.typeLines, '', ...body.lines]
    for (const att of args.attachments) {
      // Sanitize at the MIME boundary regardless of upstream: strip CR/LF/quote so a
      // crafted filename can't break out of the header (smuggling / Bcc injection).
      const name = att.filename.replace(/[\r\n"]/g, '_')
      parts.push(
        `--${mixB}`,
        `Content-Type: ${att.contentType}; name="${name}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${name}"`,
        '',
        wrap76(att.contentBase64),
      )
    }
    parts.push(`--${mixB}--`)
    mime = [
      ...headers,
      'MIME-Version: 1.0',
      `Content-Type: multipart/mixed; boundary="${mixB}"`,
      '',
      ...parts,
    ].join('\r\n')
  } else {
    mime = [...headers, 'MIME-Version: 1.0', ...body.typeLines, '', ...body.lines].join('\r\n')
  }

  return Buffer.from(mime, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// Send a plain-text email from the attorney's Google account using the Gmail
// API. Requires the gmail.send scope on the stored OAuth credentials. Throws
// a user-friendly error if Google isn't connected or the scope is missing.
export async function sendEmail(
  tenantId: string,
  args: SendEmailArgs,
  actorId?: string | null,
): Promise<SendEmailResult> {
  const creds = await loadCredentials(tenantId, actorId)
  if (!creds) {
    throw new Error('Google account not connected. Connect Google in Settings to send email.')
  }
  if (!creds.scope.includes(GMAIL_SEND_SCOPE)) {
    throw new Error(
      'Gmail send permission was not granted. Reconnect Google in Settings to enable email.',
    )
  }

  // Size guard: the whole MIME (attachments already base64 inside) is base64url-
  // re-encoded for requestBody.raw, which Gmail caps near 35 MB. base64 inflates
  // ~33% and the re-encode again, so cap total RAW attachment bytes at ~18 MB to
  // stay under the limit and fail with a clear message instead of an opaque API
  // error. (contentBase64.length * 3/4 ≈ raw bytes.)
  if (args.attachments?.length) {
    const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024
    const totalRaw = args.attachments.reduce(
      (n, a) => n + Math.ceil((a.contentBase64.length * 3) / 4),
      0,
    )
    if (totalRaw > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Attachments are too large to email (${(totalRaw / 1024 / 1024).toFixed(1)} MB; the limit is about 18 MB total).`,
      )
    }
  }

  const oauth2 = buildOAuthClient()
  oauth2.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt.getTime(),
    scope: creds.scope,
  })

  const gmail = google.gmail({ version: 'v1', auth: oauth2 })

  // Firm-branded sender: "Pacheco Law - Legal Instruments (beta)" <attorney@…>.
  // Quoted display name (the "(beta)" parentheses would otherwise read as a
  // header comment). The envelope address stays the attorney's connected account.
  const fromHeader = `"${FIRM_SENDER_DISPLAY_NAME}" <${creds.accountEmail}>`
  const raw = buildRawMessage(args, fromHeader)

  const res = await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw, threadId: args.gmailThreadId },
  })

  return {
    messageId: res.data.id ?? '',
    from: creds.accountEmail,
    to: args.to,
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Mail tab reads (WP7, REQ-CALMAIL-02/03). CLIENT-RELATED MAIL ONLY: every
// query is constrained to known matter-contact addresses — unrelated personal
// or firm mail is never fetched, let alone displayed or ingested.
// ───────────────────────────────────────────────────────────────────────────

export interface GmailThreadSummary {
  gmailThreadId: string
  subject: string
  snippet: string
  lastAt: string | null
  participantEmails: string[]
  messageCount: number
  // Real Gmail read-state (WP-I): true when any message in the thread still
  // carries the UNREAD label. This is Gmail's own signal, not a heuristic —
  // `threads.get` with format:'metadata' returns labelIds for every message.
  unread: boolean
}

export interface GmailMessage {
  gmailMessageId: string
  messageIdHeader: string | null
  from: string
  to: string
  sentAt: string | null
  bodyText: string
  // The raw text/html part when the message has one, so the reader can render the
  // real formatting (sandboxed) instead of the flattened plaintext. Absent for
  // plaintext-only messages.
  bodyHtml?: string
}

export interface GmailThreadDetail {
  gmailThreadId: string
  subject: string
  participantEmails: string[]
  messages: GmailMessage[]
}

async function gmailClient(tenantId: string, actorId?: string | null) {
  const creds = await loadCredentials(tenantId, actorId)
  if (!creds) {
    throw new Error('Google account not connected. Connect Google in Settings.')
  }
  if (!creds.scope.includes(GMAIL_READ_SCOPE)) {
    // Only legacy connections (made before Connect Google requested Gmail read)
    // land here. The MAIL_SCOPE_MISSING prefix lets the Mail tab show a one-click
    // "Reconnect Google" — a single reconnect now grants calendar + full email.
    throw new Error(
      'MAIL_SCOPE_MISSING: Gmail read permission not granted on this connection. Reconnect Google in Settings to enable email.',
    )
  }
  const oauth2 = buildOAuthClient()
  oauth2.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt.getTime(),
    scope: creds.scope,
  })
  return { gmail: google.gmail({ version: 'v1', auth: oauth2 }), creds }
}

function headerOf(msg: gmail_v1.Schema$Message, name: string): string | null {
  const h = msg.payload?.headers?.find((x) => x.name?.toLowerCase() === name.toLowerCase())
  return h?.value ?? null
}

// Decode the HTML entities Gmail emits in snippets and HTML bodies (named +
// numeric). Without this, an HTML-only email (e.g. an automated confirmation)
// shows raw "&#39;" / "&amp;" in the Mail tab. `&amp;` is decoded LAST so that
// e.g. "&amp;lt;" becomes "&lt;", not "<".
function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Convert an HTML email part to readable plain text: drop script/style, turn
// block boundaries into newlines, strip remaining tags, decode entities, and
// collapse runaway blank lines. Intentionally simple — the Mail tab renders
// plain text, not arbitrary remote HTML (which would need sanitising first).
function htmlToText(html: string): string {
  const stripped = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// Find the first part of a given MIME type anywhere in the (possibly nested)
// payload tree, decoded from base64url.
function findPart(part: gmail_v1.Schema$MessagePart | undefined, mime: string): string {
  if (!part) return ''
  if (part.mimeType === mime && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8')
  }
  for (const p of part.parts ?? []) {
    const t = findPart(p, mime)
    if (t) return t
  }
  return ''
}

// Best readable body for a message: prefer text/plain, fall back to a text/html
// part converted to text. Empty when neither exists (caller falls back to the
// entity-decoded snippet).
function extractText(part: gmail_v1.Schema$MessagePart | undefined): string {
  const plain = findPart(part, 'text/plain')
  if (plain.trim()) return plain
  const html = findPart(part, 'text/html')
  if (html.trim()) return htmlToText(html)
  return ''
}

// The message's HTML part, SANITIZED for safe rendering (allowlist chokepoint in
// sanitizeEmailHtml). Empty when the message is plaintext-only; callers omit
// bodyHtml in that case so the UI falls back to bodyText. Untrusted inbound email
// HTML must never reach the browser unsanitized.
function extractHtml(part: gmail_v1.Schema$MessagePart | undefined): string {
  const html = findPart(part, 'text/html')
  return html.trim() ? sanitizeEmailHtml(html) : ''
}

const emailsIn = (v: string | null): string[] =>
  (v ?? '')
    .split(',')
    .map((x) => x.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? '')
    .filter(Boolean)
    .map((x) => x.toLowerCase())

// List threads involving any of the given client addresses (client-mail-only
// discipline lives in the query itself).
export async function listClientThreads(
  tenantId: string,
  clientEmails: string[],
  max = 25,
  actorId?: string | null,
  search?: string,
): Promise<GmailThreadSummary[]> {
  if (clientEmails.length === 0) return []
  const { gmail } = await gmailClient(tenantId, actorId)
  // The client-address clause keeps the inbox scoped to client mail; a search
  // term is ANDed on (Gmail treats space as AND), so search never escapes that
  // scope — it filters within the client threads, Gmail-search syntax and all.
  const contactClause = clientEmails.map((e) => `(from:${e} OR to:${e})`).join(' OR ')
  const term = (search ?? '').trim()
  const q = term ? `(${contactClause}) ${term}` : contactClause
  const list = await gmail.users.threads.list({ userId: 'me', q, maxResults: max })
  const out: GmailThreadSummary[] = []
  for (const t of list.data.threads ?? []) {
    if (!t.id) continue
    const detail = await gmail.users.threads.get({
      userId: 'me',
      id: t.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'To', 'Date'],
    })
    const msgs = detail.data.messages ?? []
    const first = msgs[0]
    const last = msgs[msgs.length - 1]
    const participants = new Set<string>()
    for (const m of msgs) {
      for (const e of [...emailsIn(headerOf(m, 'From')), ...emailsIn(headerOf(m, 'To'))]) {
        participants.add(e)
      }
    }
    out.push({
      gmailThreadId: t.id,
      subject: (first && headerOf(first, 'Subject')) ?? '(no subject)',
      snippet: decodeEntities(t.snippet ?? ''),
      lastAt: last?.internalDate ? new Date(Number(last.internalDate)).toISOString() : null,
      participantEmails: [...participants],
      messageCount: msgs.length,
      unread: msgs.some((m) => (m.labelIds ?? []).includes('UNREAD')),
    })
  }
  return out
}

// Mark a thread read (clears Gmail's own UNREAD label) — the natural counterpart
// to opening it, mirroring what the real Gmail web/mobile client does on open.
// Best-effort: a legacy connection without gmail.modify, or a transient API
// failure, must never block opening the thread — the unread dot just persists
// until the next successful open.
export async function markThreadRead(
  tenantId: string,
  gmailThreadId: string,
  actorId?: string | null,
): Promise<void> {
  try {
    const { gmail, creds } = await gmailClient(tenantId, actorId)
    if (!creds.scope.includes(GMAIL_MODIFY_SCOPE)) return
    await gmail.users.threads.modify({
      userId: 'me',
      id: gmailThreadId,
      requestBody: { removeLabelIds: ['UNREAD'] },
    })
  } catch {
    // Best-effort — see comment above.
  }
}

export async function getClientThread(
  tenantId: string,
  gmailThreadId: string,
  actorId?: string | null,
): Promise<GmailThreadDetail> {
  const { gmail } = await gmailClient(tenantId, actorId)
  const detail = await gmail.users.threads.get({
    userId: 'me',
    id: gmailThreadId,
    format: 'full',
  })
  const msgs = detail.data.messages ?? []
  const participants = new Set<string>()
  const messages: GmailMessage[] = msgs.map((m) => {
    for (const e of [...emailsIn(headerOf(m, 'From')), ...emailsIn(headerOf(m, 'To'))]) {
      participants.add(e)
    }
    return {
      gmailMessageId: m.id ?? '',
      messageIdHeader: headerOf(m, 'Message-ID'),
      from: headerOf(m, 'From') ?? '',
      to: headerOf(m, 'To') ?? '',
      sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      bodyText: extractText(m.payload) || decodeEntities(m.snippet ?? ''),
      bodyHtml: extractHtml(m.payload) || undefined,
    }
  })
  const first = msgs[0]
  return {
    gmailThreadId,
    subject: (first && headerOf(first, 'Subject')) ?? '(no subject)',
    participantEmails: [...participants],
    messages,
  }
}

// RFC 2047 encoded-word for non-ASCII subject lines (accents, emoji, etc.).
function encodeHeaderIfNeeded(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s
  return `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`
}
