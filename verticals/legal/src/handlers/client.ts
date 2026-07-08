import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// Client as parent (beta sprint Objective 1). legal.client.create makes a client
// entity (with its settings) and attaches existing contacts/matters as children;
// legal.client.update changes settings or re-parents a contact/matter. All writes
// go through the action layer — these handlers are the only place client entities
// + contact_of / matter_of relationships are written.
// ───────────────────────────────────────────────────────────────────────────

const CLIENT_ENTITY_KIND = 'client'

interface ClientCreatePayload {
  client_name: string
  billable_rate?: string | null // decimal string (ADR 0044)
  billing_type?: 'hourly' | 'fixed' | null
  main_contact_id?: string | null
  // Existing entities to re-parent under this new client.
  contact_ids?: string[]
  matter_ids?: string[]
  // Optional entity metadata (additive; existing callers pass none → {}). The
  // standalone booking front door uses this to stamp a lightweight lead's email /
  // phone / reason / source on the CRM row it creates (BOOKING-FRONTDOOR-1 WP4).
  metadata?: Record<string, unknown>
}

// Write/replace a client attribute (append-only: a new attribute row supersedes).
async function setClientAttr(
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

async function attach(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    sourceId: string
    clientId: string
    relKind: 'contact_of' | 'matter_of'
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
    targetEntityId: args.clientId,
    relationshipKindId: relId,
    properties: {},
  })
}

registerActionHandler('legal.client.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ClientCreatePayload
  const name = (p.client_name ?? '').trim()
  if (!name) throw new Error('client_name is required.')

  const clientKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    CLIENT_ENTITY_KIND,
  )
  const metadata =
    p.metadata && typeof p.metadata === 'object' && !Array.isArray(p.metadata) ? p.metadata : {}
  const clientEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    clientKindId,
    name,
    metadata,
  )

  await setClientAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId: clientEntityId,
    kind: 'client_name',
    value: name,
  })
  if (p.billable_rate != null && p.billable_rate !== '') {
    await setClientAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: clientEntityId,
      kind: 'client_billable_rate',
      value: p.billable_rate,
    })
  }
  if (p.billing_type) {
    await setClientAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: clientEntityId,
      kind: 'client_billing_type',
      value: p.billing_type,
    })
  }
  if (p.main_contact_id) {
    await setClientAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: clientEntityId,
      kind: 'client_main_contact',
      value: p.main_contact_id,
    })
  }

  for (const contactId of p.contact_ids ?? []) {
    await attach(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: contactId,
      clientId: clientEntityId,
      relKind: 'contact_of',
    })
  }
  for (const matterId of p.matter_ids ?? []) {
    await attach(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: matterId,
      clientId: clientEntityId,
      relKind: 'matter_of',
    })
  }

  return { clientEntityId }
})

interface ClientUpdatePayload {
  client_entity_id: string
  client_name?: string
  billable_rate?: string | null
  billing_type?: 'hourly' | 'fixed' | null
  main_contact_id?: string | null
  // Optional re-parenting of an existing contact/matter under this client.
  attach_contact_id?: string | null
  attach_matter_id?: string | null
}

registerActionHandler('legal.client.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ClientUpdatePayload
  if (!p.client_entity_id) throw new Error('client_entity_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.client_name != null) updates.push({ kind: 'client_name', value: p.client_name.trim() })
  if (p.billable_rate != null)
    updates.push({ kind: 'client_billable_rate', value: p.billable_rate })
  if (p.billing_type != null) updates.push({ kind: 'client_billing_type', value: p.billing_type })
  if (p.main_contact_id != null)
    updates.push({ kind: 'client_main_contact', value: p.main_contact_id })

  for (const u of updates) {
    await setClientAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.client_entity_id,
      kind: u.kind,
      value: u.value,
    })
  }

  if (p.attach_contact_id) {
    await attach(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: p.attach_contact_id,
      clientId: p.client_entity_id,
      relKind: 'contact_of',
    })
  }
  if (p.attach_matter_id) {
    await attach(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceId: p.attach_matter_id,
      clientId: p.client_entity_id,
      relKind: 'matter_of',
    })
  }

  return { clientEntityId: p.client_entity_id, updated: updates.map((u) => u.kind) }
})
