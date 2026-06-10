import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

interface CallSimulatePayload {
  matter_entity_id: string
  external_call_id: string
  started_at: string
  ended_at: string
  transcript_text: string
  transcript_source: 'stub' | 'granola' | 'manual'
  raw_payload: Record<string, unknown>
}

registerActionHandler('legal.call.simulate', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as CallSimulatePayload

  const rawEventId = randomUUID()
  const contentHash = createHash('sha256')
    .update(JSON.stringify(parsed.raw_payload), 'utf8')
    .digest()
  await client.query(
    `INSERT INTO raw_event_log (id, tenant_id, source_type, source_ref, external_id, payload, content_hash)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`,
    [
      rawEventId,
      ctx.tenantId,
      'integration',
      'granola:stub',
      parsed.external_call_id,
      JSON.stringify(parsed.raw_payload),
      contentHash,
    ],
  )

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
    parsed.external_call_id,
    { raw_event_log_id: rawEventId },
  )

  const callAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'call_external_id', value: parsed.external_call_id },
    { kind: 'call_started_at', value: parsed.started_at },
    { kind: 'call_ended_at', value: parsed.ended_at },
  ]
  for (const a of callAttrs) {
    const attributeKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      a.kind,
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: callEntityId,
      attributeKindId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'integration',
      sourceRef: parsed.external_call_id,
    })
  }

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
    `Transcript for ${parsed.external_call_id}`,
  )

  const transcriptTextKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'transcript_text',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: transcriptEntityId,
    attributeKindId: transcriptTextKindId,
    value: parsed.transcript_text,
    confidence: 0.9,
    sourceType: 'integration',
    sourceRef: parsed.external_call_id,
  })

  const transcriptSourceKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'transcript_source',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: transcriptEntityId,
    attributeKindId: transcriptSourceKindId,
    value: parsed.transcript_source,
    confidence: 1.0,
    sourceType: 'system',
    sourceRef: null,
  })

  const matterCallRelKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_call',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: parsed.matter_entity_id,
    targetEntityId: callEntityId,
    relationshipKindId: matterCallRelKindId,
  })

  const matterTranscriptRelKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_transcript',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: parsed.matter_entity_id,
    targetEntityId: transcriptEntityId,
    relationshipKindId: matterTranscriptRelKindId,
  })

  const callTranscriptRelKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'call_has_transcript',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: callEntityId,
    targetEntityId: transcriptEntityId,
    relationshipKindId: callTranscriptRelKindId,
  })

  // Advance matter status.
  const statusKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_status',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: parsed.matter_entity_id,
    attributeKindId: statusKindId,
    value: 'consultation_completed',
    confidence: 1.0,
    sourceType: 'system',
    sourceRef: null,
  })

  return { callEntityId, transcriptEntityId, rawEventId }
})
