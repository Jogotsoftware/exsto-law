import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Company as the CRM account (migration 0067). A company groups its contacts
// (contact_of_company) and matters (matter_of_company); matters also connect to
// contacts (matter_contact, many-to-many). A company with engagement_status =
// 'client' is a firm client. All writes go through the action layer — these
// handlers are the only place company entities + their relationships are written.
// The company's display name is entity.name; settings live as attributes.
// ───────────────────────────────────────────────────────────────────────────

const COMPANY_ENTITY_KIND = 'company'

async function setCompanyAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

async function link(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    sourceId: string
    targetId: string
    relKind: 'contact_of_company' | 'matter_of_company' | 'matter_contact'
  },
): Promise<void> {
  const relId = await lookupKindId(
    client,
    'relationship_kind_definition',
    args.tenantId,
    args.relKind,
  )
  await insertRelationship(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    sourceEntityId: args.sourceId,
    targetEntityId: args.targetId,
    relationshipKindId: relId,
    properties: {},
  })
}

interface CompanyCreatePayload {
  company_name: string
  engagement_status?: 'prospect' | 'client' | 'inactive' | null
  billable_rate?: string | null // decimal string (ADR 0044)
  billing_type?: 'hourly' | 'fixed' | null
  main_contact_id?: string | null
  contact_ids?: string[] // existing contacts to attach
  matter_ids?: string[] // existing matters to attach
}

registerActionHandler('company.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CompanyCreatePayload
  const name = (p.company_name ?? '').trim()
  if (!name) throw new Error('company_name is required.')

  const companyKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    COMPANY_ENTITY_KIND,
  )
  const companyEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    companyKindId,
    name,
    {},
  )

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'company_engagement_status', value: p.engagement_status ?? 'prospect' },
  ]
  if (p.billable_rate != null && p.billable_rate !== '')
    attrs.push({ kind: 'company_billable_rate', value: p.billable_rate })
  if (p.billing_type) attrs.push({ kind: 'company_billing_type', value: p.billing_type })
  if (p.main_contact_id) attrs.push({ kind: 'company_main_contact', value: p.main_contact_id })

  for (const a of attrs) {
    await setCompanyAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: companyEntityId,
      kind: a.kind,
      value: a.value,
    })
  }

  for (const contactId of p.contact_ids ?? []) {
    await link(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: contactId,
      targetId: companyEntityId,
      relKind: 'contact_of_company',
    })
  }
  for (const matterId of p.matter_ids ?? []) {
    await link(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: matterId,
      targetId: companyEntityId,
      relKind: 'matter_of_company',
    })
  }

  return { companyEntityId }
})

interface CompanyUpdatePayload {
  company_entity_id: string
  company_name?: string
  engagement_status?: 'prospect' | 'client' | 'inactive' | null
  billable_rate?: string | null
  billing_type?: 'hourly' | 'fixed' | null
  main_contact_id?: string | null
}

registerActionHandler('company.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CompanyUpdatePayload
  if (!p.company_entity_id) throw new Error('company_entity_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.engagement_status != null)
    updates.push({ kind: 'company_engagement_status', value: p.engagement_status })
  if (p.billable_rate != null)
    updates.push({ kind: 'company_billable_rate', value: p.billable_rate })
  if (p.billing_type != null) updates.push({ kind: 'company_billing_type', value: p.billing_type })
  if (p.main_contact_id != null)
    updates.push({ kind: 'company_main_contact', value: p.main_contact_id })

  for (const u of updates) {
    await setCompanyAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.company_entity_id,
      kind: u.kind,
      value: u.value,
    })
  }
  // (company_name renaming is out of scope here — the display name is entity.name,
  // set at create; a rename action can be added later if needed.)

  return { companyEntityId: p.company_entity_id, updated: updates.map((u) => u.kind) }
})

// contact.set_company / matter.set_company: link a contact/matter to its company.
// matter.link_contact: connect a contact to a matter (many-to-many). These insert
// the current relationship; reads resolve "current" as the latest open link.
registerActionHandler('contact.set_company', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { contact_entity_id: string; company_entity_id: string }
  if (!p.contact_entity_id || !p.company_entity_id)
    throw new Error('contact_entity_id and company_entity_id are required.')
  await link(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceId: p.contact_entity_id,
    targetId: p.company_entity_id,
    relKind: 'contact_of_company',
  })
  return { contactEntityId: p.contact_entity_id, companyEntityId: p.company_entity_id }
})

registerActionHandler('matter.set_company', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { matter_entity_id: string; company_entity_id: string }
  if (!p.matter_entity_id || !p.company_entity_id)
    throw new Error('matter_entity_id and company_entity_id are required.')
  await link(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceId: p.matter_entity_id,
    targetId: p.company_entity_id,
    relKind: 'matter_of_company',
  })
  return { matterEntityId: p.matter_entity_id, companyEntityId: p.company_entity_id }
})

registerActionHandler('matter.link_contact', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { matter_entity_id: string; contact_entity_id: string }
  if (!p.matter_entity_id || !p.contact_entity_id)
    throw new Error('matter_entity_id and contact_entity_id are required.')
  await link(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceId: p.matter_entity_id,
    targetId: p.contact_entity_id,
    relKind: 'matter_contact',
  })
  return { matterEntityId: p.matter_entity_id, contactEntityId: p.contact_entity_id }
})
