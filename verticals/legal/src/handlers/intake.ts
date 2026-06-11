import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  insertAttribute,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// intake.submit — steps 1–3 of the intake flow (REQ-INTAKE-01..04, 07).
// Creates/reuses the client_contact (implicit account keyed by email+phone)
// and records the questionnaire_response. The matter is opened by the
// subsequent matter.open action, which wires the relationships.
// ───────────────────────────────────────────────────────────────────────────

interface IntakeSubmitPayload {
  client_full_name: string
  client_email: string
  client_phone: string | null
  client_company_name: string | null
  attribution_source?: string | null
  service_key: string
  intake_form_id: string | null
  intake_responses: Record<string, unknown>
}

// Implicit accounts are indexed by email (+ phone history). Find an existing
// client_contact whose latest email attribute matches, case-insensitively.
async function findContactByEmail(
  client: DbClient,
  tenantId: string,
  email: string,
): Promise<string | null> {
  const res = await client.query<{ entity_id: string }>(
    `WITH latest_emails AS (
       SELECT DISTINCT ON (a.entity_id)
         a.entity_id, a.value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       JOIN entity e ON e.id = a.entity_id
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE a.tenant_id = $1
         AND akd.kind_name = 'email'
         AND ekd.kind_name = 'client_contact'
         AND e.status = 'active'
       ORDER BY a.entity_id, a.valid_from DESC
     )
     SELECT entity_id FROM latest_emails
     WHERE lower(value #>> '{}') = lower($2)
     LIMIT 1`,
    [tenantId, email],
  )
  return res.rows[0]?.entity_id ?? null
}

registerActionHandler('intake.submit', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as IntakeSubmitPayload

  // client_contact — dedupe by email; append-only history keeps prior values.
  const contactKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'client_contact',
  )
  const existingContactId = await findContactByEmail(client, ctx.tenantId, p.client_email)
  const clientEntityId =
    existingContactId ??
    (await insertEntity(client, ctx.tenantId, actionId, contactKindId, p.client_full_name))

  const contactAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'full_name', value: p.client_full_name },
    { kind: 'email', value: p.client_email },
  ]
  if (p.client_phone) contactAttrs.push({ kind: 'phone', value: p.client_phone })
  if (p.client_company_name)
    contactAttrs.push({ kind: 'company_name', value: p.client_company_name })

  for (const a of contactAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: clientEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  // questionnaire_response + its structured payload.
  const respKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'questionnaire_response',
  )
  const questionnaireEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    respKindId,
    `${p.service_key} intake`,
  )
  const respAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'intake_form_id', value: p.intake_form_id ?? p.service_key },
    { kind: 'questionnaire_responses', value: p.intake_responses },
    { kind: 'response_complete', value: true },
  ]
  for (const a of respAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: questionnaireEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  return {
    clientEntityId,
    questionnaireEntityId,
    reusedContact: Boolean(existingContactId),
  }
})

// ───────────────────────────────────────────────────────────────────────────
// matter.open — opens the matter from a completed intake and wires the
// client_of / response_of relationships. Emits matter.opened.
// ───────────────────────────────────────────────────────────────────────────

interface MatterOpenPayload {
  matter_entity_id?: string
  matter_number?: string
  service_key: string
  workflow_route: 'auto' | 'manual'
  attribution_source?: string | null
  client_entity_id: string
  questionnaire_entity_id: string
  intake_action_id?: string
  summary?: string
}

registerActionHandler('matter.open', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as MatterOpenPayload

  const matterEntityId = p.matter_entity_id ?? randomUUID()
  const matterNumber = p.matter_number ?? `M-${Date.now().toString(36).toUpperCase()}`
  const matterKindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, 'matter')

  await client.query(
    `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)`,
    [
      matterEntityId,
      ctx.tenantId,
      actionId,
      matterKindId,
      matterNumber,
      JSON.stringify({ service_key: p.service_key, workflow_route: p.workflow_route }),
    ],
  )

  const matterAttrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'matter_number', value: matterNumber },
    { kind: 'service_key', value: p.service_key },
    { kind: 'workflow_route', value: p.workflow_route },
    { kind: 'matter_status', value: 'intake_submitted' },
    { kind: 'governing_law', value: 'North Carolina' },
  ]
  if (p.attribution_source) {
    matterAttrs.push({ kind: 'attribution_source', value: p.attribution_source })
  }
  for (const a of matterAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: matterEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }

  const clientOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'client_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: p.client_entity_id,
    targetEntityId: matterEntityId,
    relationshipKindId: clientOfId,
  })

  const responseOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'response_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: p.questionnaire_entity_id,
    targetEntityId: matterEntityId,
    relationshipKindId: responseOfId,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'matter.opened',
    primaryEntityId: matterEntityId,
    secondaryEntityIds: [p.client_entity_id, p.questionnaire_entity_id],
    data: {
      service_key: p.service_key,
      workflow_route: p.workflow_route,
      intake_action_id: p.intake_action_id ?? null,
    },
    sourceRef: ctx.actorId,
  })

  return { matterEntityId, matterNumber }
})
