import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

interface MatterCreatePayload {
  matter_number: string
  client_full_name: string
  client_email: string
  practice_area: string
  summary: string
}

registerActionHandler('legal.matter.create', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as MatterCreatePayload

  const matterKindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, 'matter')
  const matterEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    matterKindId,
    parsed.matter_number,
    { practice_area: parsed.practice_area },
  )

  const matterAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'matter_number', value: parsed.matter_number },
    { kind: 'practice_area', value: parsed.practice_area },
    { kind: 'client_name', value: parsed.client_full_name },
    { kind: 'matter_status', value: 'inquiry' },
    { kind: 'matter_summary', value: parsed.summary },
  ]
  for (const a of matterAttrs) {
    const attributeKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      a.kind,
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: matterEntityId,
      attributeKindId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  const clientKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'client_contact',
  )
  const clientEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    clientKindId,
    parsed.client_full_name,
  )

  const clientAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'contact_full_name', value: parsed.client_full_name },
    { kind: 'contact_email', value: parsed.client_email },
  ]
  for (const a of clientAttrs) {
    const attributeKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      a.kind,
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: clientEntityId,
      attributeKindId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  const relKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_client',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: matterEntityId,
    targetEntityId: clientEntityId,
    relationshipKindId: relKindId,
  })

  return { matterEntityId, clientEntityId }
})
