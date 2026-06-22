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
// client_of / response_of relationships, plus the client-parent grouping
// (contact_of / matter_of). Emits matter.opened.
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
  // Name for the client-parent account when one must be created (company name
  // when the intake had one, else the person's full name). Optional: callers
  // that omit it fall back to the contact entity's own name.
  client_display_name?: string | null
}

// Find the client-parent account this contact already belongs to (contact_of),
// or create one and attach the contact. Returns the client entity id. This is
// what makes an intake produce a fully-linked contact + client + matter: the
// CRM's Clients tab and matter↔client grouping read this account via contact_of
// / matter_of (queries/client.ts, matters.ts). A returning client (same
// contact) reuses their existing account instead of forking a new one per
// matter. All writes stay inside this action's transaction.
async function findOrCreateClientParent(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    contactEntityId: string
    displayName?: string | null
  },
): Promise<string> {
  const existing = await client.query<{ client_id: string }>(
    `SELECT r.target_entity_id AS client_id
     FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     JOIN entity ce ON ce.id = r.target_entity_id
     JOIN entity_kind_definition cekd ON cekd.id = ce.entity_kind_id
     WHERE r.tenant_id = $1
       AND r.source_entity_id = $2
       AND rkd.kind_name = 'contact_of'
       AND cekd.kind_name = 'client'
       AND ce.status = 'active'
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY r.valid_from DESC
     LIMIT 1`,
    [args.tenantId, args.contactEntityId],
  )
  if (existing.rows[0]) return existing.rows[0].client_id

  // Name the account after the contact: the provided display name (company or
  // person), else the contact entity's own name. Never empty.
  let name = (args.displayName ?? '').trim()
  if (!name) {
    const c = await client.query<{ name: string | null }>(
      `SELECT name FROM entity WHERE tenant_id = $1 AND id = $2`,
      [args.tenantId, args.contactEntityId],
    )
    name = (c.rows[0]?.name ?? '').trim() || 'Client'
  }

  const clientKindId = await lookupKindId(client, 'entity_kind_definition', args.tenantId, 'client')
  const clientEntityId = await insertEntity(
    client,
    args.tenantId,
    args.actionId,
    clientKindId,
    name,
    {},
  )

  const clientNameAk = await lookupKindId(
    client,
    'attribute_kind_definition',
    args.tenantId,
    'client_name',
  )
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: clientEntityId,
    attributeKindId: clientNameAk,
    value: name,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })

  const contactOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    args.tenantId,
    'contact_of',
  )
  await insertRelationship(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    sourceEntityId: args.contactEntityId,
    targetEntityId: clientEntityId,
    relationshipKindId: contactOfId,
  })

  return clientEntityId
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
  // NB: no matter_owner is stamped here. This is the PUBLIC booking/intake path —
  // ctx.actorId is the public intake actor, not an attorney — so the matter starts
  // unowned (firm-shared: any attorney may send) until an attorney is assigned via
  // legal.matter.set_owner. There is no usable create-time owner stamp: matter.open
  // is the only real create path and is public; legal.matter.create is a phantom
  // kind (0078). Wiring an attorney-facing assignment step is the PR B follow-up
  // that activates enforcement (until then it is dormant by design).
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

  // Beta feedback (intake linking): attach this matter — and, the first time,
  // the contact — to a client-parent account so intake produces a fully-linked
  // contact + client + matter, not an orphaned contact↔matter pair. The direct
  // client_of link above stays the contact↔matter source of truth; matter_of /
  // contact_of give the CRM its Clients tab and grouping.
  const clientParentId = await findOrCreateClientParent(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    contactEntityId: p.client_entity_id,
    displayName: p.client_display_name,
  })
  const matterOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: matterEntityId,
    targetEntityId: clientParentId,
    relationshipKindId: matterOfId,
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
