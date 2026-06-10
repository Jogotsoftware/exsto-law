import { randomUUID } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
import { insertAttribute, lookupKindId } from './common.js'
import type { DbClient } from '@exsto/shared'

interface ReferralPartnerPayload {
  entity_id?: string
  full_name: string
  email: string | null
  phone: string | null
  firm: string | null
  address: string | null
  specialty: string | null
  referral_terms: string | null
  notes: string | null
}

interface OtherAttorneyPayload {
  entity_id?: string
  full_name: string
  email: string | null
  phone: string | null
  firm: string | null
  bar_number: string | null
  bar_state: string | null
  role: string | null
  notes: string | null
}

async function appendAttributes(
  client: DbClient,
  ctx: { tenantId: string; actorId: string },
  actionId: string,
  entityId: string,
  pairs: Array<{ kind: string; value: string | null }>,
) {
  for (const pair of pairs) {
    if (pair.value === null || pair.value === '') continue
    const attributeKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      pair.kind,
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId,
      attributeKindId,
      value: pair.value,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }
}

async function insertEntityWithExplicitId(
  client: DbClient,
  id: string,
  tenantId: string,
  actionId: string,
  entityKindId: string,
  name: string,
): Promise<string> {
  await client.query(
    `INSERT INTO entity (id, tenant_id, action_id, entity_kind_id, name, status, metadata)
     VALUES ($1, $2, $3, $4, $5, 'active', '{}'::jsonb)`,
    [id, tenantId, actionId, entityKindId, name],
  )
  return id
}

registerActionHandler('legal.referralPartner.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ReferralPartnerPayload
  const entityId = p.entity_id ?? randomUUID()
  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'referral_partner',
  )
  await insertEntityWithExplicitId(client, entityId, ctx.tenantId, actionId, kindId, p.full_name)
  await appendAttributes(client, ctx, actionId, entityId, [
    { kind: 'partner_full_name', value: p.full_name },
    { kind: 'partner_email', value: p.email },
    { kind: 'partner_phone', value: p.phone },
    { kind: 'partner_firm', value: p.firm },
    { kind: 'partner_address', value: p.address },
    { kind: 'partner_specialty', value: p.specialty },
    { kind: 'partner_referral_terms', value: p.referral_terms },
    { kind: 'partner_notes', value: p.notes },
  ])
  return { entityId }
})

registerActionHandler('legal.referralPartner.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ReferralPartnerPayload
  if (!p.entity_id) throw new Error('entity_id is required')
  // Refresh entity.name to track the canonical display string.
  await client.query(`UPDATE entity SET name = $1 WHERE tenant_id = $2 AND id = $3`, [
    p.full_name,
    ctx.tenantId,
    p.entity_id,
  ])
  await appendAttributes(client, ctx, actionId, p.entity_id, [
    { kind: 'partner_full_name', value: p.full_name },
    { kind: 'partner_email', value: p.email },
    { kind: 'partner_phone', value: p.phone },
    { kind: 'partner_firm', value: p.firm },
    { kind: 'partner_address', value: p.address },
    { kind: 'partner_specialty', value: p.specialty },
    { kind: 'partner_referral_terms', value: p.referral_terms },
    { kind: 'partner_notes', value: p.notes },
  ])
  return { entityId: p.entity_id }
})

registerActionHandler('legal.otherAttorney.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as OtherAttorneyPayload
  const entityId = p.entity_id ?? randomUUID()
  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'other_attorney',
  )
  await insertEntityWithExplicitId(client, entityId, ctx.tenantId, actionId, kindId, p.full_name)
  await appendAttributes(client, ctx, actionId, entityId, [
    { kind: 'attorney_full_name', value: p.full_name },
    { kind: 'attorney_email', value: p.email },
    { kind: 'attorney_phone', value: p.phone },
    { kind: 'attorney_firm', value: p.firm },
    { kind: 'attorney_bar_number', value: p.bar_number },
    { kind: 'attorney_bar_state', value: p.bar_state },
    { kind: 'attorney_role', value: p.role },
    { kind: 'attorney_notes', value: p.notes },
  ])
  return { entityId }
})

registerActionHandler('legal.otherAttorney.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as OtherAttorneyPayload
  if (!p.entity_id) throw new Error('entity_id is required')
  await client.query(`UPDATE entity SET name = $1 WHERE tenant_id = $2 AND id = $3`, [
    p.full_name,
    ctx.tenantId,
    p.entity_id,
  ])
  await appendAttributes(client, ctx, actionId, p.entity_id, [
    { kind: 'attorney_full_name', value: p.full_name },
    { kind: 'attorney_email', value: p.email },
    { kind: 'attorney_phone', value: p.phone },
    { kind: 'attorney_firm', value: p.firm },
    { kind: 'attorney_bar_number', value: p.bar_number },
    { kind: 'attorney_bar_state', value: p.bar_state },
    { kind: 'attorney_role', value: p.role },
    { kind: 'attorney_notes', value: p.notes },
  ])
  return { entityId: p.entity_id }
})
