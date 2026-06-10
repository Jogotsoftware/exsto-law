import { google } from 'googleapis'
import { buildOAuthClient, loadCredentials, GMAIL_SEND_SCOPE } from './googleCalendar.js'

export interface SendEmailArgs {
  to: string
  subject: string
  body: string
}

export interface SendEmailResult {
  messageId: string
  from: string
  to: string
}

// Send a plain-text email from the attorney's Google account using the Gmail
// API. Requires the gmail.send scope on the stored OAuth credentials. Throws
// a user-friendly error if Google isn't connected or the scope is missing.
export async function sendEmail(tenantId: string, args: SendEmailArgs): Promise<SendEmailResult> {
  const creds = await loadCredentials(tenantId)
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

  const mime = [
    `To: ${args.to}`,
    `From: ${creds.accountEmail}`,
    `Subject: ${encodeHeaderIfNeeded(args.subject)}`,
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
    requestBody: { raw },
  })

  return {
    messageId: res.data.id ?? '',
    from: creds.accountEmail,
    to: args.to,
  }
}

// RFC 2047 encoded-word for non-ASCII subject lines (accents, emoji, etc.).
function encodeHeaderIfNeeded(s: string): string {
  if (/^[\x20-\x7e]*$/.test(s)) return s
  return `=?UTF-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`
}
