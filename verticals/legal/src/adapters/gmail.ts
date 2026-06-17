import { google, type gmail_v1 } from 'googleapis'
import {
  buildOAuthClient,
  loadCredentials,
  GMAIL_SEND_SCOPE,
  GMAIL_READ_SCOPE,
} from './googleCalendar.js'

export interface SendEmailArgs {
  to: string
  subject: string
  body: string
  // Reply support (WP7 Mail tab): thread the message into an existing Gmail
  // conversation.
  gmailThreadId?: string
  inReplyToMessageIdHeader?: string
}

export interface SendEmailResult {
  messageId: string
  from: string
  to: string
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

  const headers = [
    `To: ${args.to}`,
    `From: ${creds.accountEmail}`,
    `Subject: ${encodeHeaderIfNeeded(args.subject)}`,
  ]
  if (args.inReplyToMessageIdHeader) {
    headers.push(`In-Reply-To: ${args.inReplyToMessageIdHeader}`)
    headers.push(`References: ${args.inReplyToMessageIdHeader}`)
  }
  const mime = [
    ...headers,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    args.body,
  ].join('\r\n')

  const raw = Buffer.from(mime, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

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
    throw new Error(
      'MAIL_SCOPE_MISSING: Gmail read permission not granted yet. Enable Mail to grant it (incremental consent).',
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

function extractText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return ''
  if (part.mimeType === 'text/plain' && part.body?.data) {
    return Buffer.from(part.body.data, 'base64url').toString('utf-8')
  }
  for (const p of part.parts ?? []) {
    const t = extractText(p)
    if (t) return t
  }
  return ''
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
): Promise<GmailThreadSummary[]> {
  if (clientEmails.length === 0) return []
  const { gmail } = await gmailClient(tenantId, actorId)
  const q = clientEmails.map((e) => `(from:${e} OR to:${e})`).join(' OR ')
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
      snippet: t.snippet ?? '',
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
    return {
      gmailMessageId: m.id ?? '',
      messageIdHeader: headerOf(m, 'Message-ID'),
      from: headerOf(m, 'From') ?? '',
      to: headerOf(m, 'To') ?? '',
      sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : null,
      bodyText: extractText(m.payload) || (m.snippet ?? ''),
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
