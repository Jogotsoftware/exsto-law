// Resend-backed transactional sender for the notification engine's `email`
// channel (api/notifications.ts DRIVERS.email). This is the DEFAULT client-facing
// path once CLIENT_EMAIL_API_KEY / CLIENT_EMAIL_FROM are configured: one verified
// firm domain (noreply@…) so e-sign links, booking, and every other client
// notification leave from a single firm address even when no attorney has
// connected Gmail — which is the common case in production. Reply-To is set to a
// human (attorney, else firm email) so clients can still reply.
//
// Mirrors apps/legal-demo/lib/clientEmail.ts (same Resend {from,to,subject,html,
// text} POST) but lives in the vertical so it is reachable from the worker's
// deliverNotification() path, which the Next app's lib is not. When Resend is
// unconfigured the driver falls back to the attorney's Gmail (adapters/gmail.ts),
// preserving prior behaviour.
//
// Type-only import: erased at compile time, so this does NOT pull the heavy
// googleapis runtime from gmail.ts into the Resend path.
import type { EmailAttachment } from './gmail.js'

export interface ResendSendArgs {
  to: string
  subject: string
  text: string
  html?: string
  // File attachments (e.g. the stamped executed PDF on e-sign completion).
  attachments?: EmailAttachment[]
  // Reply-To header — lets client replies reach a human while the visible
  // sender stays noreply@. Omitted when null/undefined.
  replyTo?: string | null
  // Free-text display name ("Pacheco Law Firm <noreply@…>"); the address itself
  // must stay CLIENT_EMAIL_FROM (Resend verifies the address's domain, not the
  // name).
  fromName?: string | null
}

export function resendConfigured(): boolean {
  return Boolean(process.env.CLIENT_EMAIL_API_KEY && process.env.CLIENT_EMAIL_FROM)
}

export async function sendViaResend(args: ResendSendArgs): Promise<{ messageId: string | null }> {
  const apiKey = process.env.CLIENT_EMAIL_API_KEY
  const fromAddr = process.env.CLIENT_EMAIL_FROM
  if (!apiKey || !fromAddr) {
    throw new Error('Resend not configured (CLIENT_EMAIL_API_KEY / CLIENT_EMAIL_FROM)')
  }
  const endpoint = process.env.CLIENT_EMAIL_ENDPOINT ?? 'https://api.resend.com/emails'
  const from = args.fromName ? `${args.fromName} <${fromAddr}>` : fromAddr
  const body: Record<string, unknown> = {
    from,
    to: [args.to],
    subject: args.subject,
    text: args.text,
  }
  if (args.html) body.html = args.html
  if (args.replyTo) body.reply_to = args.replyTo
  if (args.attachments?.length) {
    // Resend attachment shape: { filename, content (base64), content_type }.
    body.attachments = args.attachments.map((a) => ({
      filename: a.filename,
      content: a.contentBase64,
      content_type: a.contentType,
    }))
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Resend send failed (${res.status}): ${detail}`)
  }
  const json = (await res.json().catch(() => ({}))) as { id?: string }
  return { messageId: json.id ?? null }
}
