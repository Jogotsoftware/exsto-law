import { registerActionHandler } from '@exsto/substrate'
import {
  getLatestAttributeValue,
  insertAttribute,
  insertEntity,
  insertRelationship,
  lookupKindId,
} from './common.js'

interface QuestionnaireSubmitPayload {
  matter_entity_id: string
  template_id: string
  responses: Record<string, unknown>
}

registerActionHandler('legal.questionnaire.submit', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as QuestionnaireSubmitPayload

  const responseKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'questionnaire_response',
  )
  const responseEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    responseKindId,
    `${parsed.template_id} response`,
    { template_id: parsed.template_id },
  )

  const templateAttrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'questionnaire_template',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: responseEntityId,
    attributeKindId: templateAttrKindId,
    value: parsed.template_id,
    confidence: 1.0,
    sourceType: 'system',
    sourceRef: null,
  })

  const responsesAttrKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'questionnaire_responses',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: responseEntityId,
    attributeKindId: responsesAttrKindId,
    value: parsed.responses,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  const linkKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_questionnaire',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: parsed.matter_entity_id,
    targetEntityId: responseEntityId,
    relationshipKindId: linkKindId,
  })

  // Advance the matter status to questionnaire_submitted.
  const statusKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_status',
  )
  const current = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    parsed.matter_entity_id,
    'matter_status',
  )
  if (current !== 'questionnaire_submitted') {
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: parsed.matter_entity_id,
      attributeKindId: statusKindId,
      value: 'questionnaire_submitted',
      confidence: 1.0,
      sourceType: 'system',
      sourceRef: null,
    })
  }

  return { questionnaireEntityId: responseEntityId }
})
