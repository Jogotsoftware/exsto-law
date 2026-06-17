import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  getRelatedEntityIds,
  insertAttribute,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// call.ingest — project a (raw_event_log'd) Granola payload into call_session
// + transcript entities (REQ-CALL-02/03, invariant 13: deterministic
// projection). Idempotent on granola_call_id: replaying the same webhook
// creates no duplicates. matter_entity_id may be null — unmatched transcripts
// land in the review queue (call_sessions without a call_of relationship),
// never the void.
// ───────────────────────────────────────────────────────────────────────────

interface CallIngestPayload {
  granola_call_id: string
  matter_entity_id: string | null
  started_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  transcript_text: string
  transcript_source: 'granola' | 'stub' | 'manual'
  notes: Record<string, unknown> | null
  attendee_emails?: string[]
  raw_event_log_id?: string | null
  // Provenance overrides. The Granola webhook path leaves these unset and the
  // facts carry integration/granola provenance. A manual entry (the attorney
  // recording a real call) passes source_type='human' + source_ref=actorId so
  // the substrate records who actually asserted it (Hard rule 4).
  source_type?: 'integration' | 'human' | 'agent' | 'system'
  source_ref?: string
}

async function findCallByGranolaId(
  client: DbClient,
  tenantId: string,
  granolaCallId: string,
): Promise<string | null> {
  const res = await client.query<{ entity_id: string }>(
    `SELECT a.entity_id FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND akd.kind_name = 'granola_call_id'
       AND a.value #>> '{}' = $2
     LIMIT 1`,
    [tenantId, granolaCallId],
  )
  return res.rows[0]?.entity_id ?? null
}

registerActionHandler('call.ingest', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CallIngestPayload
  // Default to integration/Granola provenance; a manual entry overrides both.
  const sourceType = p.source_type ?? 'integration'
  const sourceRef = p.source_ref ?? `granola:${p.granola_call_id}`

  // Idempotency: a replayed webhook or re-run projection is a no-op.
  const existing = await findCallByGranolaId(client, ctx.tenantId, p.granola_call_id)
  if (existing) {
    return { callEntityId: existing, deduplicated: true }
  }

  const callKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'call_session',
  )
  const callEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    callKindId,
    `Call ${p.granola_call_id}`,
    {
      raw_event_log_id: p.raw_event_log_id ?? null,
      attendee_emails: p.attendee_emails ?? [],
      transcript_source: p.transcript_source,
    },
  )

  const callAttrs: Array<{ kind: string; value: unknown; precision?: string }> = [
    { kind: 'granola_call_id', value: p.granola_call_id },
  ]
  if (p.started_at)
    callAttrs.push({ kind: 'call_started_at', value: p.started_at, precision: 'second' })
  if (p.ended_at) callAttrs.push({ kind: 'call_ended_at', value: p.ended_at, precision: 'second' })
  if (p.duration_seconds != null)
    callAttrs.push({ kind: 'call_duration_seconds', value: p.duration_seconds })
  if (p.notes) callAttrs.push({ kind: 'call_notes', value: p.notes })

  for (const a of callAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: callEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      timePrecision: a.precision ?? 'exact_instant',
      sourceType,
      sourceRef,
    })
  }

  // Transcript entity + content.
  const transcriptKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'transcript',
  )
  const transcriptEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    transcriptKindId,
    `Transcript for ${p.granola_call_id}`,
  )
  const wordCount = p.transcript_text.split(/\s+/).filter(Boolean).length
  const transcriptAttrs: Array<{ kind: string; value: unknown; confidence?: number }> = [
    { kind: 'transcript_text', value: p.transcript_text, confidence: 0.9 },
    { kind: 'transcript_source', value: p.transcript_source },
    { kind: 'transcript_word_count', value: wordCount },
  ]
  for (const a of transcriptAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: transcriptEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: a.confidence ?? 1.0,
      sourceType,
      sourceRef,
    })
  }

  // transcript_of: transcript → call_session (WP1 seed kinds).
  const transcriptOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'transcript_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: transcriptEntityId,
    targetEntityId: callEntityId,
    relationshipKindId: transcriptOfId,
  })

  // call_of: call_session → matter, only when matched.
  if (p.matter_entity_id) {
    const callOfId = await lookupKindId(
      client,
      'relationship_kind_definition',
      ctx.tenantId,
      'call_of',
    )
    await insertRelationship(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceEntityId: callEntityId,
      targetEntityId: p.matter_entity_id,
      relationshipKindId: callOfId,
    })

    const statusKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'matter_status',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.matter_entity_id,
      attributeKindId: statusKindId,
      value: 'consulted',
      confidence: 1.0,
      sourceType,
      sourceRef,
    })
  }

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'transcript.received',
    primaryEntityId: p.matter_entity_id ?? callEntityId,
    secondaryEntityIds: p.matter_entity_id
      ? [callEntityId, transcriptEntityId]
      : [transcriptEntityId],
    data: {
      granola_call_id: p.granola_call_id,
      matched: Boolean(p.matter_entity_id),
      transcript_source: p.transcript_source,
      word_count: wordCount,
    },
    sourceType,
    sourceRef,
    occurredAt: p.ended_at ?? null,
  })

  return {
    callEntityId,
    transcriptEntityId,
    matched: Boolean(p.matter_entity_id),
    deduplicated: false,
  }
})

// ───────────────────────────────────────────────────────────────────────────
// legal.call.assign — route a call from the review queue to a matter (beta
// sprint Obj 8). Adds call_of (call_session → matter) so the call surfaces on
// the matter's and the contact's calls list. The attorney is the source, so the
// link carries human provenance. Linking only: matter_status is left untouched,
// so assigning a call to an already-advanced matter cannot regress its stage.
// ───────────────────────────────────────────────────────────────────────────

interface CallAssignPayload {
  call_entity_id: string
  matter_entity_id: string
}

async function requireActiveEntity(
  client: DbClient,
  tenantId: string,
  entityId: string,
  kindName: string,
): Promise<void> {
  const res = await client.query<{ id: string }>(
    `SELECT e.id FROM entity e
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = $3
     WHERE e.tenant_id = $1 AND e.id = $2 AND e.status = 'active'`,
    [tenantId, entityId, kindName],
  )
  if (!res.rows[0]) throw new Error(`${kindName} not found: ${entityId}`)
}

registerActionHandler('legal.call.assign', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CallAssignPayload
  await requireActiveEntity(client, ctx.tenantId, p.call_entity_id, 'call_session')
  await requireActiveEntity(client, ctx.tenantId, p.matter_entity_id, 'matter')

  // Idempotency / safety: a call already attached to a matter is not re-routed
  // here (a deliberate re-assignment is a separate flow). No-op, report the link.
  const existing = await getRelatedEntityIds(client, ctx.tenantId, p.call_entity_id, 'call_of')
  if (existing.length > 0) {
    return { callEntityId: p.call_entity_id, matterEntityId: existing[0], alreadyAssigned: true }
  }

  const callOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'call_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: p.call_entity_id,
    targetEntityId: p.matter_entity_id,
    relationshipKindId: callOfId,
  })

  return {
    callEntityId: p.call_entity_id,
    matterEntityId: p.matter_entity_id,
    alreadyAssigned: false,
  }
})
