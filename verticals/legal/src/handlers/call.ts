import { registerActionHandler, withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  getRelatedEntityIds,
  insertAttribute,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'
import { dispatchLifecycleEvent } from '../lifecycle/executor.js'

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

    // MACHINE-COMMS-1 (WP1): transcripts join the graph DIRECTLY — transcript →
    // matter and transcript → client — so client memory assembles without hops.
    await linkTranscriptDirect(client, ctx.tenantId, actionId, transcriptEntityId, [
      p.matter_entity_id,
    ])

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

  // ADR 0045 — drive any matter whose lifecycle waits ON transcript.received. ONLY
  // for a matched matter (an unmatched transcript has no instance to advance). This
  // is lifecycle advance ONLY — drafting still happens via api/granolaIngestion's
  // own auto-draft path, so we do NOT double-fire it here. Flag-guarded no-op when
  // the engine is off / the matter has no waiting edge; commits in this transaction.
  if (p.matter_entity_id) {
    await dispatchLifecycleEvent(client, ctx, p.matter_entity_id, 'transcript.received', actionId)
  }

  // P11 — consultation capture is AUTOMATIC. A matched transcript with text enqueues
  // the transcript_extraction capability POST-COMMIT (the ad-hoc path — the model call
  // runs on the worker, never in this transaction). Hooking here covers every arrival
  // with one seam: webhook, folder import, manual paste/upload. Unmatched transcripts
  // go to the review queue and must NOT enqueue (no matter to extract onto). The
  // per-TRANSCRIPT guard below is the idempotency AND cost control — each capture is
  // a real model call, and the ad-hoc path has no (matter, stage) guard of its own.
  if (p.matter_entity_id && p.transcript_text.trim()) {
    const matterEntityId = p.matter_entity_id
    const base: ActionContext = { tenantId: ctx.tenantId, actorId: ctx.actorId }
    ctx.afterCommit?.push(async () => {
      try {
        if (await transcriptAlreadyExtracted(base, transcriptEntityId)) return
        const { enqueueAdHocCapabilityJob } = await import('../api/capabilityRuntime.js')
        await enqueueAdHocCapabilityJob(base, {
          capabilitySlug: 'transcript_extraction',
          matterEntityId,
          config: { transcript_entity_id: transcriptEntityId },
        })
      } catch (err) {
        console.error(
          `[call.ingest] auto-capture enqueue failed for transcript ${transcriptEntityId} (transcript is stored; extract from the matter page):`,
          err instanceof Error ? err.message : err,
        )
      }
    })
  }

  return {
    callEntityId,
    transcriptEntityId,
    matched: Boolean(p.matter_entity_id),
    deduplicated: false,
  }
})

// P11 — has THIS transcript already been extracted? Keyed on the transcript ENTITY,
// never the call id: a manual re-paste mints a new call id per paste, and the ad-hoc
// capability path deliberately bypasses the per-(matter, stage) capability.invoked
// guard. Two signals count as done: a transcript.extracted event referencing the
// transcript, or (in case the event write failed after the notes landed) an
// ai_summary note pointing at it via note_about.
async function transcriptAlreadyExtracted(
  ctx: ActionContext,
  transcriptEntityId: string,
): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ done: boolean }>(
      `SELECT (
         EXISTS (
           SELECT 1 FROM event e
             JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
            WHERE e.tenant_id = $1 AND ekd.kind_name = 'transcript.extracted'
              AND ($2::uuid = ANY(e.secondary_entity_ids)
                   OR e.payload->>'transcript_entity_id' = $2::text)
         ) OR EXISTS (
           SELECT 1 FROM relationship r
             JOIN relationship_kind_definition rkd
                  ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'note_about'
             JOIN attribute a ON a.tenant_id = r.tenant_id AND a.entity_id = r.source_entity_id
             JOIN attribute_kind_definition akd
                  ON akd.id = a.attribute_kind_id AND akd.kind_name = 'note_source'
            WHERE r.tenant_id = $1 AND r.target_entity_id = $2::uuid
              AND a.value #>> '{}' = 'ai_summary'
         )
       ) AS done`,
      [ctx.tenantId, transcriptEntityId],
    )
    return res.rows[0]?.done === true
  })
}

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

// MACHINE-COMMS-1 (WP1) — write the DIRECT transcript links: transcript_of_matter
// (transcript → each matter) and transcript_of_client (transcript → the matter's
// parent client via matter_of). The relationship kinds are runtime-defined
// (demo/seed-comms-kinds.ts, kind.define). A tenant that has not seeded them yet
// (e.g. the CI migration-only database) skips with a warning — linkage is an
// additive enrichment and must not fail the ingest that carries the transcript.
async function linkTranscriptDirect(
  client: DbClient,
  tenantId: string,
  actionId: string,
  transcriptEntityId: string,
  matterEntityIds: string[],
): Promise<void> {
  const kindId = async (name: string): Promise<string | null> => {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM relationship_kind_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
        ORDER BY valid_from DESC LIMIT 1`,
      [tenantId, name],
    )
    return r.rows[0]?.id ?? null
  }
  const matterKindId = await kindId('transcript_of_matter')
  const clientKindId = await kindId('transcript_of_client')
  if (!matterKindId || !clientKindId) {
    console.warn(
      '[call] transcript_of_matter/transcript_of_client kinds not defined in this tenant — direct transcript links skipped (run demo/seed-comms-kinds.ts).',
    )
    return
  }
  for (const matterId of matterEntityIds) {
    await insertRelationship(client, {
      tenantId,
      actionId,
      sourceEntityId: transcriptEntityId,
      targetEntityId: matterId,
      relationshipKindId: matterKindId,
    })
    const clients = await getRelatedEntityIds(client, tenantId, matterId, 'matter_of')
    if (clients[0]) {
      await insertRelationship(client, {
        tenantId,
        actionId,
        sourceEntityId: transcriptEntityId,
        targetEntityId: clients[0],
        relationshipKindId: clientKindId,
      })
    }
  }
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

  // MACHINE-COMMS-1 (WP1): assigning the call also links its transcripts directly
  // to the matter/client (same enrichment call.ingest writes for a matched call).
  const transcripts = await client.query<{ id: string }>(
    `SELECT r.source_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.target_entity_id = $2 AND rkd.kind_name = 'transcript_of'`,
    [ctx.tenantId, p.call_entity_id],
  )
  for (const t of transcripts.rows) {
    await linkTranscriptDirect(client, ctx.tenantId, actionId, t.id, [p.matter_entity_id])
  }

  return {
    callEntityId: p.call_entity_id,
    matterEntityId: p.matter_entity_id,
    alreadyAssigned: false,
  }
})
