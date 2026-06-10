import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'
import type { DbClient } from '@exsto/shared'

interface BookingSubmitPayload {
  matter_entity_id?: string
  matter_number?: string
  client_full_name: string
  client_email: string
  client_phone: string | null
  client_company_name: string | null
  attribution_source: string
  service_key: string
  intake_responses: Record<string, unknown>
  scheduled_at: string
  scheduled_end: string | null
  notion_event_id: string | null
  google_event_id: string | null
  google_event_url: string | null
}

async function insertEntityWithExplicitId(
  client: DbClient,
  id: string,
  tenantId: string,
  actionId: string,
  entityKindId: string,
  name: string,
  metadata: Record<string, unknown> = {},
): Promise<string> {
  await client.query(
    `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'active', $6::jsonb)`,
    [id, tenantId, actionId, entityKindId, name, JSON.stringify(metadata)],
  )
  return id
}

// Find an existing client_contact entity for this tenant whose latest
// contact_email attribute matches the given email (case-insensitive).
// Returns the entity id, or null if no match.
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
         AND akd.kind_name = 'contact_email'
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

registerActionHandler('legal.booking.submit', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as BookingSubmitPayload

  // Pull linked templates + referral target so the matter knows up-front
  // which templates apply and (if relevant) who it'd be referred to.
  const serviceMeta = await client.query<{
    id: string
    default_referral_partner_id: string | null
    template_keys: string[] | null
  }>(
    `SELECT s.id, s.default_referral_partner_id,
            ARRAY(
              SELECT dt.template_key
              FROM service_document_template sdt
              JOIN document_template dt ON dt.id = sdt.template_id
              WHERE sdt.tenant_id = s.tenant_id
                AND sdt.service_id = s.id
                AND sdt.autopopulate = true
              ORDER BY sdt.sort_order, dt.display_name
            ) AS template_keys
     FROM service_definition s
     WHERE s.tenant_id = $1 AND s.service_key = $2`,
    [ctx.tenantId, p.service_key],
  )
  const linkedTemplateKeys = serviceMeta.rows[0]?.template_keys ?? []
  const defaultReferralPartnerId = serviceMeta.rows[0]?.default_referral_partner_id ?? null

  const matterEntityId = p.matter_entity_id ?? randomUUID()
  const matterNumber = p.matter_number ?? `M-${Date.now().toString(36).toUpperCase()}`
  const matterKindId = await lookupKindId(client, 'entity_kind_definition', ctx.tenantId, 'matter')
  await insertEntityWithExplicitId(
    client,
    matterEntityId,
    ctx.tenantId,
    actionId,
    matterKindId,
    matterNumber,
    {
      service_key: p.service_key,
      scheduled_at: p.scheduled_at,
      scheduled_end: p.scheduled_end,
      notion_event_id: p.notion_event_id,
      google_event_id: p.google_event_id,
      google_event_url: p.google_event_url,
      linked_template_keys: linkedTemplateKeys,
      default_referral_partner_id: defaultReferralPartnerId,
    },
  )

  for (const a of [
    { kind: 'matter_number', value: matterNumber },
    { kind: 'practice_area', value: p.service_key },
    { kind: 'client_name', value: p.client_full_name },
    { kind: 'matter_status', value: 'consultation_scheduled' },
    { kind: 'matter_summary', value: summarize(p) },
  ]) {
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

  // client_contact — dedupe by email. If a contact already exists for this
  // tenant with the same email, reuse it and append fresh attribute rows.
  // Append-only history means prior values stay queryable.
  const clientKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'client_contact',
  )
  const existingContactId = await findContactByEmail(client, ctx.tenantId, p.client_email)
  const clientEntityId =
    existingContactId ??
    (await insertEntity(client, ctx.tenantId, actionId, clientKindId, p.client_full_name))
  const reusedContact = Boolean(existingContactId)

  const contactAttrs: Array<{ kind: string; value: string }> = [
    { kind: 'contact_full_name', value: p.client_full_name },
    { kind: 'contact_email', value: p.client_email },
  ]
  if (p.client_phone) contactAttrs.push({ kind: 'contact_phone', value: p.client_phone })
  if (p.client_company_name)
    contactAttrs.push({ kind: 'contact_company_name', value: p.client_company_name })
  if (p.attribution_source)
    contactAttrs.push({ kind: 'contact_attribution_source', value: p.attribution_source })

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

  const linkKindId = await lookupKindId(
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
    relationshipKindId: linkKindId,
  })

  // questionnaire_response
  const respKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'questionnaire_response',
  )
  const respEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    respKindId,
    `${p.service_key} intake`,
    { template_id: p.service_key },
  )
  const tmplAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'questionnaire_template',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: respEntityId,
    attributeKindId: tmplAttrId,
    value: p.service_key,
    confidence: 1.0,
    sourceType: 'system',
    sourceRef: null,
  })
  const respAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'questionnaire_responses',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: respEntityId,
    attributeKindId: respAttrId,
    value: p.intake_responses,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })
  const respRelId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_questionnaire',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: matterEntityId,
    targetEntityId: respEntityId,
    relationshipKindId: respRelId,
  })

  return {
    matterEntityId,
    matterNumber,
    clientEntityId,
    reusedContact,
    questionnaireEntityId: respEntityId,
    scheduledAt: p.scheduled_at,
    googleEventUrl: p.google_event_url,
    googleEventId: p.google_event_id,
  }
})

function summarize(p: BookingSubmitPayload): string {
  const r = p.intake_responses ?? {}
  if (p.service_key === 'single_member_llc') {
    return `Single-member NC LLC formation for ${(r['company_name'] as string) ?? '(unnamed entity)'}`
  }
  if (p.service_key === 'multi_member_llc') {
    return `Multi-member NC LLC formation for ${(r['company_name'] as string) ?? '(unnamed entity)'}`
  }
  if (p.service_key === 'llc_formation') {
    return `NC LLC formation for ${(r['company_name'] as string) ?? '(unnamed entity)'}`
  }
  if (p.service_key === 'oa_amendment') {
    return `OA amendment for ${(r['existing_llc_name'] as string) ?? '(unnamed LLC)'}`
  }
  const need = (r['need_summary'] as string | undefined) ?? ''
  return `Custom matter — ${need.slice(0, 120)}`
}
