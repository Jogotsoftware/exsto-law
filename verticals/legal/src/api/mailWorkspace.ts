// Mail workspace (WP7, REQ-CALMAIL-02/03): client-related Gmail in-app —
// read, reply, compose — with every send through mail.send (provenance
// integration:gmail) and inbound mail ingested idempotently via mail.ingest.
// SCOPE DISCIPLINE: every Gmail query is constrained to known matter-contact
// addresses; unrelated personal/firm mail is never fetched or stored.
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import {
  listClientThreads,
  getClientThread,
  sendEmail,
  type GmailThreadSummary,
  type GmailThreadDetail,
} from '../adapters/gmail.js'

// All client_contact emails with their matters (the allow-list that scopes
// every Gmail query).
async function clientEmailIndex(
  ctx: ActionContext,
): Promise<Map<string, Array<{ matterEntityId: string; matterNumber: string }>>> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      email: string
      matter_id: string
      matter_number: string
    }>(
      `WITH latest_emails AS (
         SELECT DISTINCT ON (a.entity_id) a.entity_id, lower(a.value #>> '{}') AS email
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE a.tenant_id = $1 AND akd.kind_name = 'email' AND ekd.kind_name = 'client_contact'
         ORDER BY a.entity_id, a.valid_from DESC
       )
       SELECT le.email, m.id AS matter_id, m.name AS matter_number
       FROM latest_emails le
       JOIN relationship r ON r.source_entity_id = le.entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
       JOIN entity m ON m.id = r.target_entity_id
       WHERE m.tenant_id = $1 AND m.status = 'active'`,
      [ctx.tenantId],
    )
    const map = new Map<string, Array<{ matterEntityId: string; matterNumber: string }>>()
    for (const row of res.rows) {
      const list = map.get(row.email) ?? []
      list.push({ matterEntityId: row.matter_id, matterNumber: row.matter_number })
      map.set(row.email, list)
    }
    return map
  })
}

export interface MailThreadSummary extends GmailThreadSummary {
  matters: Array<{ matterEntityId: string; matterNumber: string }>
}

export async function listMailThreads(ctx: ActionContext): Promise<{
  threads: MailThreadSummary[]
  clientEmailCount: number
}> {
  const index = await clientEmailIndex(ctx)
  const emails = [...index.keys()].filter((e) => !e.endsWith('@example.test'))
  if (emails.length === 0) return { threads: [], clientEmailCount: 0 }
  const threads = await listClientThreads(ctx.tenantId, emails, 25, ctx.actorId)
  return {
    clientEmailCount: emails.length,
    threads: threads.map((t) => ({
      ...t,
      matters: dedupeMatters(t.participantEmails.flatMap((e) => index.get(e.toLowerCase()) ?? [])),
    })),
  }
}

function dedupeMatters(
  list: Array<{ matterEntityId: string; matterNumber: string }>,
): Array<{ matterEntityId: string; matterNumber: string }> {
  const seen = new Map<string, { matterEntityId: string; matterNumber: string }>()
  for (const m of list) seen.set(m.matterEntityId, m)
  return [...seen.values()]
}

export interface MailThreadView extends GmailThreadDetail {
  matters: Array<{ matterEntityId: string; matterNumber: string }>
}

// Open a thread: live read from Gmail + idempotent ingestion into the
// substrate (mail.ingest), matter-matched by participant emails.
export async function openMailThread(
  ctx: ActionContext,
  gmailThreadId: string,
): Promise<MailThreadView> {
  const detail = await getClientThread(ctx.tenantId, gmailThreadId, ctx.actorId)
  const index = await clientEmailIndex(ctx)
  const matters = dedupeMatters(
    detail.participantEmails.flatMap((e) => index.get(e.toLowerCase()) ?? []),
  )

  // Scope discipline: a thread with no known client participant is not ours
  // to store or display.
  if (matters.length === 0 && !detail.participantEmails.some((e) => index.has(e.toLowerCase()))) {
    throw new Error('Thread has no known client participant; not a client thread.')
  }

  await submitAction(ctx, {
    actionKindName: 'mail.ingest',
    intentKind: 'automatic_sync',
    payload: {
      gmail_thread_id: detail.gmailThreadId,
      subject: detail.subject,
      participant_emails: detail.participantEmails,
      matter_entity_id: matters[0]?.matterEntityId ?? null,
      messages: detail.messages.map((m) => ({
        gmail_message_id: m.gmailMessageId,
        from: m.from,
        to: m.to,
        sent_at: m.sentAt,
        body_text: m.bodyText,
      })),
    },
  })

  return { ...detail, matters }
}

export interface ReplyInput {
  gmailThreadId: string
  bodyText: string
}

// Reply in-app: goes out through the attorney's real Gmail, recorded as a
// mail.send action with provenance integration:gmail.
export async function replyToThread(ctx: ActionContext, input: ReplyInput): Promise<ActionResult> {
  const detail = await getClientThread(ctx.tenantId, input.gmailThreadId, ctx.actorId)
  const index = await clientEmailIndex(ctx)
  const clientParticipant = detail.participantEmails.find((e) => index.has(e.toLowerCase()))
  if (!clientParticipant) {
    throw new Error('Refusing to reply: thread has no known client participant.')
  }
  const last = detail.messages[detail.messages.length - 1]
  const sent = await sendEmail(
    ctx.tenantId,
    {
      to: clientParticipant,
      subject: detail.subject.startsWith('Re:') ? detail.subject : `Re: ${detail.subject}`,
      body: input.bodyText,
      gmailThreadId: input.gmailThreadId,
      inReplyToMessageIdHeader: last?.messageIdHeader ?? undefined,
    },
    ctx.actorId,
  )
  const matters = dedupeMatters(
    detail.participantEmails.flatMap((e) => index.get(e.toLowerCase()) ?? []),
  )
  return submitAction(ctx, {
    actionKindName: 'mail.send',
    intentKind: 'enforcement',
    payload: {
      gmail_thread_id: input.gmailThreadId,
      gmail_message_id: sent.messageId,
      subject: detail.subject,
      to: clientParticipant,
      from: sent.from,
      body_text: input.bodyText,
      matter_entity_id: matters[0]?.matterEntityId ?? null,
      participant_emails: detail.participantEmails,
    },
  })
}

export interface ComposeInput {
  to: string
  subject: string
  bodyText: string
}

export async function composeToClient(
  ctx: ActionContext,
  input: ComposeInput,
): Promise<ActionResult> {
  const index = await clientEmailIndex(ctx)
  const matters = index.get(input.to.toLowerCase())
  if (!matters || matters.length === 0) {
    throw new Error(
      `Refusing to compose: ${input.to} is not a known client contact (client-mail-only discipline).`,
    )
  }
  const sent = await sendEmail(
    ctx.tenantId,
    {
      to: input.to,
      subject: input.subject,
      body: input.bodyText,
    },
    ctx.actorId,
  )
  return submitAction(ctx, {
    actionKindName: 'mail.send',
    intentKind: 'enforcement',
    payload: {
      gmail_thread_id: null,
      gmail_message_id: sent.messageId,
      subject: input.subject,
      to: input.to,
      from: sent.from,
      body_text: input.bodyText,
      matter_entity_id: matters[0]!.matterEntityId,
      participant_emails: [input.to, sent.from],
    },
  })
}

export interface MatterCommunication {
  threadId: string
  subject: string
  lastPreview: string | null
  lastAt: string | null
  messageCount: number
}

// Matter-scoped communication history from the substrate (works offline from
// Gmail — this is the ingested record).
export async function matterCommunications(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterCommunication[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      subject: string | null
      last_preview: string | null
      last_at: string | null
      n: string
    }>(
      `SELECT t.id, t.subject,
              (SELECT m.body_preview FROM communication_message m
                WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id
                ORDER BY m.occurred_at DESC LIMIT 1) AS last_preview,
              (SELECT to_char(max(m.occurred_at), 'YYYY-MM-DD"T"HH24:MI:SSOF')
                 FROM communication_message m
                WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id) AS last_at,
              (SELECT count(*) FROM communication_message m
                WHERE m.tenant_id = t.tenant_id AND m.thread_id = t.id) AS n
       FROM communication_thread t
       WHERE t.tenant_id = $1 AND $2::uuid = ANY(t.related_entity_ids)
       ORDER BY last_at DESC NULLS LAST`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map((r) => ({
      threadId: r.id,
      subject: r.subject ?? '(no subject)',
      lastPreview: r.last_preview,
      lastAt: r.last_at,
      messageCount: Number(r.n),
    }))
  })
}
