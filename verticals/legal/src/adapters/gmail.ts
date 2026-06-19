import { google, type gmail_v1 } from 'googleapis'
import {
  buildOAuthClient,
  loadCredentials,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
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
  if (args.inReplyToMessageIdHeader) {
    headers.push(`In-Reply-To: ${args.inReplyToMessageIdHeader}`)
    headers.push(`References: ${args.inReplyToMessageIdHeader}`)
  }
  const seed = Buffer.from(`${args.to}:${args.subject}`).toString('hex').slice(0, 24)

  // The body section: a bare text/plain, or a multipart/alternative (plaintext +
  // HTML) when an html part is supplied. Returns its own Content-Type header
  // line(s) so it can sit at the top level OR be nested inside multipart/mixed.
  function bodySection(): { typeLines: string[]; lines: string[] } {
    if (args.html) {
      const altB = `=_exsto_alt_${seed}`
      return {
        typeLines: [`Content-Type: multipart/alternative; boundary="${altB}"`],
        lines: [
          `--${altB}`,
          'Content-Type: text/plain; charset="UTF-8"',
          'Content-Transfer-Encoding: 8bit',
          '',
          args.body,
          `--${altB}`,
          'Content-Type: text/html; charset="UTF-8"',
          'Content-Transfer-Encoding: 8bit',
          '',
          args.html,
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
      parts.push(
        `--${mixB}`,
        `Content-Type: ${att.contentType}; name="${att.filename}"`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${att.filename}"`,
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
}

export interface GmailMessage {
  gmailMessageId: string
  messageIdHeader: string | null
  from: string
  to: string
  sentAt: string | null
  bodyText: string
  // Sanitized HTML body (formatting preserved), when the message has an HTML
  // part. Already passed through sanitizeEmailHtml on the server, so it is safe
  // to render directly; absent for plaintext-only messages. The UI renders this
  // when present and falls back to bodyText otherwise.
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

// The message's HTML part, SANITIZED for safe rendering. Returns '' when the
// message is plaintext-only — callers omit bodyHtml in that case so the UI
// falls back to bodyText. Untrusted email HTML is dangerous; sanitizeEmailHtml
// is the single allowlist chokepoint (see sanitizeEmailHtml.ts).
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
    })
  }
  return out
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
    const bodyHtml = extractHtml(m.payload)
    return {
      gmailMessageId: m.id ?? '',
      messageIdHeader: headerOf(m, 'Message-ID'),
      from: headerOf(m, 'From') ?? '',
      to: headerOf(m, 'To') ?? '',
      sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      bodyText: extractText(m.payload) || decodeEntities(m.snippet ?? ''),
      ...(bodyHtml ? { bodyHtml } : {}),
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
