// Brief engine WP2 — legal.brief.generate handler (design: scratchpad
// brief-engine-design.md §3). Persists a synthesized brief as a runtime-defined
// `brief` entity (migration 0169): create-or-supersede so there is exactly ONE
// live brief per (target, brief_type) while the full version history is retained
// append-only (each regeneration closes the prior open attribute rows via
// valid_to and appends new ones — the calendarCategories.ts / firmSettings.ts
// supersession shape).
//
// This is an AI operation: the caller (api/briefEngine.ts persistBrief) persists
// the reasoning trace first and submits WITH reasoning_trace_id set — the action
// kind has requires_reasoning_trace=true, so submitAction rejects a null trace
// (exsto-ai-operation). Provenance on every fact is `agent` + the model identity.
//
// STALENESS SAFETY: the payload key is `target_entity_id`, NOT `matter_entity_id`.
// getMatterHistory keys the matter timeline (and thus the staleness watermark) on
// payload->>'matter_entity_id'; using a different key keeps a brief generation OUT
// of the matter's own history, so a freshly generated brief is never instantly
// stale. A brief is a derived read, not matter activity.
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

const BRIEF_KIND = 'brief'
const BRIEF_OF = 'brief_of'

interface BriefGeneratePayload {
  target_entity_id: string
  brief_type: string // matter | client | service_digest
  brief_markdown: string
  brief_json: unknown // structured sections
  brief_generated_at: string // ISO
  brief_source_watermark: string // ISO
  brief_model_identity: string
  brief_confidence: number
  brief_research_json?: unknown | null // Client Brief only (WP3)
  reasoning_trace_id: string
}

// The tenant's active brief entity for (target, type), or null on first generation.
async function findLiveBrief(
  client: DbClient,
  tenantId: string,
  targetEntityId: string,
  briefType: string,
): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = $4
       JOIN relationship r ON r.source_entity_id = e.id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            AND rkd.kind_name = 'brief_of'
       JOIN attribute ta ON ta.entity_id = e.id
       JOIN attribute_kind_definition tak ON tak.id = ta.attribute_kind_id
            AND tak.kind_name = 'brief_type'
      WHERE e.tenant_id = $1 AND e.status = 'active'
        AND r.target_entity_id = $2
        AND (r.valid_to IS NULL OR r.valid_to > now())
        AND ta.value #>> '{}' = $3
        AND (ta.valid_to IS NULL OR ta.valid_to > now())
      ORDER BY e.created_at ASC
      LIMIT 1`,
    [tenantId, targetEntityId, briefType, BRIEF_KIND],
  )
  return res.rows[0]?.id ?? null
}

// Append one attribute on the brief entity, first closing the prior open value of
// the same kind (bitemporal supersession — valid_to is the only mutable column on
// an open fact row). On first creation `superseding` is false (nothing to close).
async function writeBriefAttr(args: {
  client: DbClient
  tenantId: string
  actionId: string
  entityId: string
  kindName: string
  value: unknown
  sourceRef: string
  superseding: boolean
}): Promise<void> {
  const akId = await lookupKindId(
    args.client,
    'attribute_kind_definition',
    args.tenantId,
    args.kindName,
  )
  if (args.superseding) {
    await args.client.query(
      `UPDATE attribute SET valid_to = now()
        WHERE tenant_id = $1 AND entity_id = $2 AND attribute_kind_id = $3 AND valid_to IS NULL`,
      [args.tenantId, args.entityId, akId],
    )
  }
  await insertAttribute(args.client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0, // the FACT "this is the brief body" is certain; model uncertainty lives in brief_confidence
    sourceType: 'agent',
    sourceRef: args.sourceRef,
  })
}

registerActionHandler('legal.brief.generate', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as BriefGeneratePayload
  const target = (p.target_entity_id ?? '').trim()
  const briefType = (p.brief_type ?? '').trim()
  if (!target) throw new Error('legal.brief.generate: target_entity_id is required.')
  if (!briefType) throw new Error('legal.brief.generate: brief_type is required.')
  const modelIdentity = (p.brief_model_identity ?? '').trim() || 'unknown-model'

  const existing = await findLiveBrief(client, ctx.tenantId, target, briefType)
  const superseding = existing !== null

  let briefEntityId: string
  if (existing) {
    briefEntityId = existing
  } else {
    const kindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, BRIEF_KIND)
    briefEntityId = await insertEntity(client, ctx.tenantId, actionId, kindId, 'Brief', {
      brief_type: briefType,
    })
    const relKindId = await lookupKindId(
      client,
      'relationship_kind_definition',
      ctx.tenantId,
      BRIEF_OF,
    )
    await insertRelationship(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceEntityId: briefEntityId,
      targetEntityId: target,
      relationshipKindId: relKindId,
    })
  }

  const write = (kindName: string, value: unknown): Promise<void> =>
    writeBriefAttr({
      client,
      tenantId: ctx.tenantId,
      actionId,
      entityId: briefEntityId,
      kindName,
      value,
      sourceRef: modelIdentity,
      superseding,
    })

  await write('brief_type', briefType)
  await write('brief_markdown', p.brief_markdown ?? '')
  await write('brief_json', p.brief_json ?? [])
  await write('brief_generated_at', p.brief_generated_at)
  await write('brief_source_watermark', p.brief_source_watermark)
  await write('brief_model_identity', modelIdentity)
  await write('brief_confidence', p.brief_confidence)
  // Client-Brief-only external research (WP3): only written when present, so a
  // matter brief leaves the attribute genuinely absent rather than a null row.
  if (p.brief_research_json != null) {
    await write('brief_research_json', p.brief_research_json)
  }

  return { briefEntityId, superseded: superseding }
})
