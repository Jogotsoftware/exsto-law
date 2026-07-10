import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  insertAttribute,
  insertEntity,
  insertRelationship,
  insertEvent,
  lookupKindId,
  getLatestAttributeValue,
} from './common.js'
import { dispatchClientDelivery } from './clientDelivery.js'

const REQUEST_TYPE_LABEL: Record<string, string> = {
  meeting: 'Meeting',
  document: 'Document',
  review: 'Attorney review',
}

// ───────────────────────────────────────────────────────────────────────────
// Client request handlers (migration 0092). A `client_request` is a cost-gated
// ask from the portal (meeting / document / review). .create makes one with the
// price the CLIENT ACCEPTED (the API computes it server-side and passes it here —
// never trusted from the browser); .accept / .start / .decline move it through its
// lifecycle by superseding request_status (append-only). .fulfill is special: it
// books the accepted amount as a matter service fee AND flips the status to
// fulfilled in ONE transaction (so a repeat fulfil can never double-bill or orphan
// a fee), stamping request_billed_event_id with the recorded fee event.
// ───────────────────────────────────────────────────────────────────────────

const REQUEST_ENTITY_KIND = 'client_request'
const REQUEST_TYPES = new Set(['meeting', 'document', 'review'])
const MONEY_RE = /^\d+(\.\d{1,2})?$/

async function setAttr(
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

interface CreatePayload {
  matter_entity_id: string
  client_contact_id: string
  request_type: string
  description?: string | null
  // Authoritative, server-computed price (the quote the client accepted).
  price_amount: string
  currency: string
  price_basis: string
  duration_minutes?: number | null
  accepted_at: string
}

registerActionHandler('legal.client_request.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CreatePayload
  const matterId = (p.matter_entity_id ?? '').trim()
  const contactId = (p.client_contact_id ?? '').trim()
  if (!matterId) throw new Error('matter_entity_id is required.')
  if (!contactId) throw new Error('client_contact_id is required.')
  if (!REQUEST_TYPES.has(p.request_type))
    throw new Error(`Unknown request type "${p.request_type}".`)
  const amount = (p.price_amount ?? '').trim()
  if (!MONEY_RE.test(amount)) throw new Error('A request must carry a valid accepted price.')

  const requestKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    REQUEST_ENTITY_KIND,
  )
  const name = `${p.request_type} request`
  const requestId = await insertEntity(client, ctx.tenantId, actionId, requestKindId, name, {})

  // Link to the matter and to the requesting client_contact.
  const ofKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'client_request_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: requestId,
    targetEntityId: matterId,
    relationshipKindId: ofKindId,
  })
  const fromKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'client_request_from',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: requestId,
    targetEntityId: contactId,
    relationshipKindId: fromKindId,
  })

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'request_type', value: p.request_type },
    { kind: 'request_status', value: 'requested' },
    { kind: 'request_price_amount', value: amount },
    { kind: 'request_currency', value: (p.currency ?? 'USD').trim() || 'USD' },
    { kind: 'request_price_basis', value: (p.price_basis ?? '').trim() },
    { kind: 'request_accepted_at', value: p.accepted_at },
  ]
  if (p.description != null && String(p.description).trim()) {
    attrs.push({ kind: 'request_description', value: String(p.description).trim() })
  }
  if (p.duration_minutes != null && Number.isFinite(Number(p.duration_minutes))) {
    attrs.push({
      kind: 'request_duration_minutes',
      value: String(Math.round(Number(p.duration_minutes))),
    })
  }
  for (const a of attrs) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: requestId,
      ...a,
    })
  }

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'client_request.created',
    primaryEntityId: requestId,
    secondaryEntityIds: [matterId, contactId],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: { request_type: p.request_type, amount, currency: (p.currency ?? 'USD').trim() || 'USD' },
  })

  return { requestId }
})

// Shared transition for the non-billing moves (accept / start / decline):
// supersede status + emit the matching state-change event, gated on a valid
// from-status. Fulfilment is NOT one of these — it also books a fee, so it has a
// dedicated handler below that does the fee + status in ONE transaction.
function registerTransition(
  actionKind: string,
  toStatus: string,
  eventKind: string,
  fromStatuses: Set<string>,
) {
  registerActionHandler(actionKind, async (ctx, client, payload, actionId) => {
    const p = payload as unknown as { request_id?: string }
    const requestId = (p.request_id ?? '').trim()
    if (!requestId) throw new Error('request_id is required.')

    const current = await getStatus(client, ctx.tenantId, requestId)
    if (current === null) throw new Error('Request not found.')
    if (!fromStatuses.has(current)) {
      throw new Error(`A ${current} request cannot be moved to ${toStatus}.`)
    }

    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: requestId,
      kind: 'request_status',
      value: toStatus,
    })
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: eventKind,
      primaryEntityId: requestId,
      secondaryEntityIds: [],
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })

    return { requestId, status: toStatus }
  })
}

// Fulfil = book the accepted amount as a matter service fee AND move the request
// to 'fulfilled', atomically in one action transaction. Doing the fee here (rather
// than in a separate submitAction in the API layer) means the status guard and the
// fee commit or roll back together — a second fulfil throws BEFORE any fee is
// booked, so there is no double-bill and no orphan fee. The fee uses the same
// service_fee.recorded ledger event the firm's manual fees do, so it rolls into the
// next invoice via the existing billing path.
registerActionHandler('legal.client_request.fulfill', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as { request_id?: string }
  const requestId = (p.request_id ?? '').trim()
  if (!requestId) throw new Error('request_id is required.')

  const current = await getStatus(client, ctx.tenantId, requestId)
  if (current === null) throw new Error('Request not found.')
  if (!new Set(['requested', 'accepted', 'in_progress']).has(current)) {
    throw new Error(`A ${current} request cannot be fulfilled.`)
  }

  const amount =
    (await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      requestId,
      'request_price_amount',
    )) ?? '0'
  const requestType =
    (await getLatestAttributeValue<string>(client, ctx.tenantId, requestId, 'request_type')) ??
    'request'
  const matterId = await getRelatedTarget(client, ctx.tenantId, requestId, 'client_request_of')

  // Book the fee (service_fee.recorded) when there's a matter + a positive amount.
  let billedEventId: string | null = null
  if (matterId && /^\d+(\.\d{1,2})?$/.test(amount) && Number(amount) > 0) {
    const serviceKey = await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      matterId,
      'service_key',
    )
    billedEventId = await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'service_fee.recorded',
      primaryEntityId: matterId,
      secondaryEntityIds: [requestId],
      sourceType: 'human',
      sourceRef: ctx.actorId,
      data: {
        service_key: serviceKey ?? null,
        amount,
        description: `Client request: ${REQUEST_TYPE_LABEL[requestType] ?? requestType}`,
      },
    })
  }

  const updates: Array<{ kind: string; value: unknown }> = [
    { kind: 'request_status', value: 'fulfilled' },
  ]
  if (billedEventId) updates.push({ kind: 'request_billed_event_id', value: billedEventId })
  for (const u of updates) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: requestId,
      ...u,
    })
  }

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'client_request.fulfilled',
    primaryEntityId: requestId,
    secondaryEntityIds: matterId ? [matterId] : [],
    sourceType: 'human',
    sourceRef: ctx.actorId,
    data: billedEventId ? { billed_event_id: billedEventId } : {},
  })

  return { requestId, status: 'fulfilled', billed: billedEventId !== null }
})

// The current target entity of a (source -> target) relationship by kind name.
async function getRelatedTarget(
  client: DbClient,
  tenantId: string,
  sourceId: string,
  kindName: string,
): Promise<string | null> {
  const res = await client.query<{ target: string }>(
    `SELECT r.target_entity_id AS target
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = $3
        AND (r.valid_to IS NULL OR r.valid_to > now())
      ORDER BY r.valid_from DESC LIMIT 1`,
    [tenantId, sourceId, kindName],
  )
  return res.rows[0]?.target ?? null
}

async function getStatus(
  client: DbClient,
  tenantId: string,
  requestId: string,
): Promise<string | null> {
  const res = await client.query<{ value: string }>(
    `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'request_status'
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, requestId],
  )
  return res.rows[0]?.value ?? null
}

// BACKHALF-BLOCKS-1 (WP3) — legal.client_request.accept now has TWO payload forms:
//   • { request_id }        — the original client_request-entity transition (the
//     attorney accepts a portal ask). Unchanged.
//   • { matter_entity_id }  — the CLIENT accepts the current client-gated stage
//     (e.g. "Accept the draft" on the portal's client-review step). This is the
//     dormant path wired live: the accept IS the client's delivery, so it advances
//     the matter's client gate via the same dispatchClientDelivery every other
//     client action (upload / reply / booking) uses — the edge's `via` must name
//     'legal.client_request.accept' (now in the client gate vocabulary).
registerActionHandler('legal.client_request.accept', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as {
    request_id?: string
    matter_entity_id?: string
    client_contact_id?: string
    note?: string
  }
  const requestId = (p.request_id ?? '').trim()
  const matterEntityId = (p.matter_entity_id ?? '').trim()

  if (requestId) {
    // Original form: move the client_request entity requested → accepted.
    const current = await getStatus(client, ctx.tenantId, requestId)
    if (current === null) throw new Error('Request not found.')
    if (current !== 'requested') {
      throw new Error(`A ${current} request cannot be moved to accepted.`)
    }
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: requestId,
      kind: 'request_status',
      value: 'accepted',
    })
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'client_request.accepted',
      primaryEntityId: requestId,
      secondaryEntityIds: [],
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
    return { requestId, status: 'accepted' }
  }

  if (!matterEntityId) throw new Error('request_id or matter_entity_id is required.')

  // Matter form: the client's acceptance is recorded on the matter and advances
  // its client gate (no-op when the current stage has no matching client edge —
  // same idempotent contract as every dispatchClientDelivery caller).
  const clientRef = (p.client_contact_id ?? '').trim()
  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'client_request.accepted',
    primaryEntityId: matterEntityId,
    secondaryEntityIds: [],
    sourceType: 'human',
    sourceRef: clientRef ? `client_contact:${clientRef}` : ctx.actorId,
    data: { accepted: 'client_review', note: (p.note ?? '').trim() || null },
  })
  const advanced = await dispatchClientDelivery(
    client,
    ctx,
    matterEntityId,
    'legal.client_request.accept',
    actionId,
    clientRef ? `client_contact:${clientRef}` : null,
  )
  return { matterEntityId, accepted: true, advancedTo: advanced?.to ?? null }
})
registerTransition(
  'legal.client_request.start',
  'in_progress',
  'client_request.in_progress',
  new Set(['accepted', 'requested']),
)
// 'legal.client_request.fulfill' is a dedicated handler above (it books a fee).
registerTransition(
  'legal.client_request.decline',
  'declined',
  'client_request.declined',
  new Set(['requested', 'accepted', 'in_progress']),
)
