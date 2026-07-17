import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertContentBlob } from './common.js'
import { randomUUID } from 'node:crypto'

// ───────────────────────────────────────────────────────────────────────────
// mail.ingest / mail.send (WP7, REQ-CALMAIL-02) — client mail projected into
// communication_thread / communication_message (core append-only tables).
// Threads dedupe on the Gmail thread id (participants jsonb carries it);
// messages are idempotent on the Gmail message id (payload jsonb).
// ───────────────────────────────────────────────────────────────────────────

interface IngestMessage {
  gmail_message_id: string
  from: string
  to: string
  sent_at: string | null
  body_text: string
}

interface MailIngestPayload {
  gmail_thread_id: string
  subject: string
  participant_emails: string[]
  matter_entity_id: string | null
  messages: IngestMessage[]
}

async function findThreadByGmailId(
  client: DbClient,
  tenantId: string,
  gmailThreadId: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM communication_thread
     WHERE tenant_id = $1 AND participants->>'gmail_thread_id' = $2
     LIMIT 1`,
    [tenantId, gmailThreadId],
  )
  return res.rows[0]?.id ?? null
}

async function ensureThread(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    gmailThreadId: string
    subject: string
    participantEmails: string[]
    matterEntityId: string | null
  },
): Promise<string> {
  const existing = await findThreadByGmailId(client, args.tenantId, args.gmailThreadId)
  if (existing) return existing
  const id = randomUUID()
  await client.query(
    `INSERT INTO communication_thread
       (id, tenant_id, action_id, thread_kind, subject, participants, related_entity_ids, status)
     VALUES ($1, $2, $3, 'email', $4, $5::jsonb, $6, 'active')`,
    [
      id,
      args.tenantId,
      args.actionId,
      args.subject,
      JSON.stringify({
        gmail_thread_id: args.gmailThreadId,
        emails: args.participantEmails,
      }),
      args.matterEntityId ? [args.matterEntityId] : [],
    ],
  )
  return id
}

async function insertMailMessage(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    threadId: string
    gmailMessageId: string
    from: string
    to: string
    sentAt: string | null
    bodyText: string
    direction: 'inbound' | 'outbound'
  },
): Promise<boolean> {
  // Idempotent on the Gmail message id.
  const dupe = await client.query(
    `SELECT 1 FROM communication_message
     WHERE tenant_id = $1 AND thread_id = $2 AND payload->>'gmail_message_id' = $3`,
    [args.tenantId, args.threadId, args.gmailMessageId],
  )
  if ((dupe.rowCount ?? 0) > 0) return false

  const blobId = await insertContentBlob(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    contentType: 'text/plain',
    body: args.bodyText,
  })
  await client.query(
    `INSERT INTO communication_message
       (id, tenant_id, action_id, thread_id, body_blob_id, body_preview, payload,
        source_type, source_ref, occurred_at, occurred_at_precision)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'integration','integration:gmail',
             COALESCE($8::timestamptz, now()), 'second')`,
    [
      randomUUID(),
      args.tenantId,
      args.actionId,
      args.threadId,
      blobId,
      args.bodyText.slice(0, 280),
      JSON.stringify({
        gmail_message_id: args.gmailMessageId,
        from: args.from,
        to: args.to,
        direction: args.direction,
      }),
      args.sentAt,
    ],
  )
  return true
}

registerActionHandler('mail.ingest', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MailIngestPayload
  const threadId = await ensureThread(client, {
    tenantId: ctx.tenantId,
    actionId,
    gmailThreadId: p.gmail_thread_id,
    subject: p.subject,
    participantEmails: p.participant_emails,
    matterEntityId: p.matter_entity_id,
  })
  let inserted = 0
  for (const m of p.messages) {
    const fresh = await insertMailMessage(client, {
      tenantId: ctx.tenantId,
      actionId,
      threadId,
      gmailMessageId: m.gmail_message_id,
      from: m.from,
      to: m.to,
      sentAt: m.sent_at,
      bodyText: m.body_text,
      direction: 'inbound',
    })
    if (fresh) inserted += 1
  }
  return { threadId, inserted, total: p.messages.length }
})

interface MailSendPayload {
  gmail_thread_id: string | null
  gmail_message_id: string
  subject: string
  to: string
  // Optional Cc (firm staff only — validated in enqueueClientEmail). Carried on
  // the action payload for the audit record; Cc addresses also appear in
  // participant_emails so the thread projection includes them.
  cc?: string | null
  from: string
  body_text: string
  matter_entity_id: string | null
  participant_emails?: string[]
}

registerActionHandler('mail.send', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MailSendPayload
  const threadId = await ensureThread(client, {
    tenantId: ctx.tenantId,
    actionId,
    gmailThreadId: p.gmail_thread_id ?? `outbound-${p.gmail_message_id}`,
    subject: p.subject,
    participantEmails: p.participant_emails ?? [p.to, p.from],
    matterEntityId: p.matter_entity_id,
  })
  await insertMailMessage(client, {
    tenantId: ctx.tenantId,
    actionId,
    threadId,
    gmailMessageId: p.gmail_message_id,
    from: p.from,
    to: p.to,
    sentAt: new Date().toISOString(),
    bodyText: p.body_text,
    direction: 'outbound',
  })
  // The mail.send action row (with provenance integration:gmail) is the audit
  // record; no separate lifecycle event kind is defined for mail in Phase 0.
  return { threadId, gmailMessageId: p.gmail_message_id }
})
