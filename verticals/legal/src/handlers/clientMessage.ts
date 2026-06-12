import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertContentBlob, insertEvent } from './common.js'
import { randomUUID } from 'node:crypto'

// ───────────────────────────────────────────────────────────────────────────
// client.message.post / attorney.message.post (Client Portal PR2) — two-way
// client↔attorney messaging projected into the core append-only communication
// tables (communication_thread + communication_message, core 0009). Mirrors
// handlers/mail.ts: one thread, content_blob body, body_preview, payload tag.
//
// ONE portal thread per matter. We DO NOT alter the core thread_kind CHECK; the
// thread reuses thread_kind 'email' and is marked channel:'portal' in the
// participants jsonb, with related_entity_ids=[matterEntityId] so the attorney's
// matterCommunications read (api/mailWorkspace.ts) picks it up for free.
//
// Provenance (the distinguishing PR2 model):
//   • client message:   sender_entity_id = clientContactId, sender_actor_id NULL,
//                        source_type 'human', source_ref 'client_contact:<id>',
//                        payload.author 'client'.
//   • attorney message: sender_actor_id = ctx.actorId (the attorney actor),
//                        sender_entity_id NULL, source_type 'human',
//                        source_ref 'actor:<id>', payload.author 'attorney'.
// ───────────────────────────────────────────────────────────────────────────

const PREVIEW_LEN = 280

// Find THE portal thread for a matter (channel:'portal' in participants, the
// matter in related_entity_ids). One per matter — the unique anchor that makes
// ensureThread idempotent without a DB constraint on a core table.
async function findPortalThread(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT id FROM communication_thread
     WHERE tenant_id = $1
       AND participants->>'channel' = 'portal'
       AND $2::uuid = ANY(related_entity_ids)
     ORDER BY recorded_at ASC
     LIMIT 1`,
    [tenantId, matterEntityId],
  )
  return res.rows[0]?.id ?? null
}

// Ensure-or-create the matter's single portal thread (mirrors mail.ts ensureThread).
async function ensurePortalThread(
  client: DbClient,
  args: { tenantId: string; actionId: string; matterEntityId: string },
): Promise<string> {
  const existing = await findPortalThread(client, args.tenantId, args.matterEntityId)
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
      'Client portal messages',
      JSON.stringify({ channel: 'portal', matter_entity_id: args.matterEntityId }),
      [args.matterEntityId],
    ],
  )
  return id
}

// Append one message to the portal thread (content_blob body + body_preview +
// provenance). author/sender split is the caller's; mirrors insertMailMessage.
async function insertPortalMessage(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    threadId: string
    body: string
    senderActorId: string | null
    senderEntityId: string | null
    sourceRef: string
    author: 'client' | 'attorney'
  },
): Promise<string> {
  const blobId = await insertContentBlob(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    contentType: 'text/plain',
    body: args.body,
  })
  const id = randomUUID()
  await client.query(
    `INSERT INTO communication_message
       (id, tenant_id, action_id, thread_id, sender_actor_id, sender_entity_id,
        body_blob_id, body_preview, payload, source_type, source_ref,
        occurred_at, occurred_at_precision)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'human',$10, now(), 'second')`,
    [
      id,
      args.tenantId,
      args.actionId,
      args.threadId,
      args.senderActorId,
      args.senderEntityId,
      blobId,
      args.body.slice(0, PREVIEW_LEN),
      JSON.stringify({ author: args.author, channel: 'portal' }),
      args.sourceRef,
    ],
  )
  return id
}

interface ClientMessagePayload {
  matter_entity_id: string
  client_contact_id: string
  body: string
}

registerActionHandler('client.message.post', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ClientMessagePayload
  const body = (p.body ?? '').trim()
  if (!body) throw new Error('Message body is required.')
  if (!p.client_contact_id) throw new Error('client_contact_id is required.')

  const threadId = await ensurePortalThread(client, {
    tenantId: ctx.tenantId,
    actionId,
    matterEntityId: p.matter_entity_id,
  })

  const messageId = await insertPortalMessage(client, {
    tenantId: ctx.tenantId,
    actionId,
    threadId,
    body,
    // CLIENT provenance: identity is the client_contact ENTITY, not an actor
    // (ADR 0035). The action's actor is the public-intake system actor.
    senderActorId: null,
    senderEntityId: p.client_contact_id,
    sourceRef: `client_contact:${p.client_contact_id}`,
    author: 'client',
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'client.message.received',
    primaryEntityId: p.matter_entity_id,
    data: { thread_id: threadId, message_id: messageId, preview: body.slice(0, PREVIEW_LEN) },
    sourceType: 'human',
    sourceRef: `client_contact:${p.client_contact_id}`,
  })

  return { threadId, messageId, author: 'client' as const }
})

interface AttorneyMessagePayload {
  matter_entity_id: string
  body: string
}

registerActionHandler('attorney.message.post', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AttorneyMessagePayload
  const body = (p.body ?? '').trim()
  if (!body) throw new Error('Message body is required.')

  const threadId = await ensurePortalThread(client, {
    tenantId: ctx.tenantId,
    actionId,
    matterEntityId: p.matter_entity_id,
  })

  const messageId = await insertPortalMessage(client, {
    tenantId: ctx.tenantId,
    actionId,
    threadId,
    body,
    // ATTORNEY provenance: identity is the acting attorney ACTOR.
    senderActorId: ctx.actorId,
    senderEntityId: null,
    sourceRef: `actor:${ctx.actorId}`,
    author: 'attorney',
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'attorney.message.sent',
    primaryEntityId: p.matter_entity_id,
    data: { thread_id: threadId, message_id: messageId, preview: body.slice(0, PREVIEW_LEN) },
    sourceType: 'human',
    sourceRef: `actor:${ctx.actorId}`,
  })

  return { threadId, messageId, author: 'attorney' as const }
})
