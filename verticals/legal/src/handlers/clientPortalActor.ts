// PORTAL-1 — clients become real actors + universal fee consent (migration 0135).
//
// legal.client.provision_portal_actor: a portal account = an actor linked to its
// client_contact. The actor's external_id is 'client:<contactId>' — NEVER the
// email — because attorney Google sign-in resolves actors by
// lower(external_id)=lower(email) (api/identity.ts); an email-keyed client actor
// would let a client's Google login mint an ATTORNEY session. Idempotent:
// re-provisioning returns the existing actor. Provisioning also advances any of
// the client's matters parked on a client gate whose `via` is this action — the
// send_portal_invite stage's "account created" advance.
//
// legal.fee.quote / legal.fee.accept / legal.fee.decline: the consent ledger.
// A quote is computed and recorded server-side (fee.quoted); the client's OWN
// actor accepts or declines it (fee.accepted / fee.declined echo the quoted
// terms, referencing the quote event). Billable acts are gated on the
// acceptance event existing (api/feeConsent.ts), enforced at the act — never in
// the UI.
import { randomUUID } from 'node:crypto'
import { registerActionHandler, type ActionEffectHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEvent, lookupKindId, getLatestAttributeValue } from './common.js'
import { dispatchClientDelivery } from './clientDelivery.js'

// Idempotent scope assignment: give the actor the client.portal rung unless it
// already holds it (0136).
async function ensureClientPortalScope(
  client: DbClient,
  tenantId: string,
  actionId: string,
  actorId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO actor_scope_assignment (tenant_id, action_id, actor_id, permission_scope_definition_id)
     SELECT $1, $2, $3, psd.id
     FROM permission_scope_definition psd
     WHERE psd.tenant_id = $1 AND psd.scope_name = 'client.portal'
       AND (psd.valid_to IS NULL OR psd.valid_to > now())
       AND NOT EXISTS (
         SELECT 1 FROM actor_scope_assignment asa
         WHERE asa.tenant_id = $1 AND asa.actor_id = $3
           AND asa.permission_scope_definition_id = psd.id
           AND (asa.valid_to IS NULL OR asa.valid_to > now())
       )
     LIMIT 1`,
    [tenantId, actionId, actorId],
  )
}

async function contactDisplayName(
  client: DbClient,
  tenantId: string,
  contactId: string,
): Promise<string> {
  const name = await getLatestAttributeValue<string>(client, tenantId, contactId, 'full_name')
  if (name) return name
  const email = await getLatestAttributeValue<string>(client, tenantId, contactId, 'email')
  return email ?? 'Portal client'
}

interface ProvisionPayload {
  client_contact_id: string
  matter_entity_ids?: string[]
  trigger?: 'intake_gate' | 'invite' | 'login_backfill'
}

registerActionHandler(
  'legal.client.provision_portal_actor',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as ProvisionPayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')

    // The contact must be an active client_contact in this tenant.
    const contact = await client.query<{ id: string }>(
      `SELECT e.id FROM entity e
     JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
     WHERE e.id = $1 AND e.tenant_id = $2
       AND ekd.kind_name = 'client_contact' AND e.status = 'active'`,
      [p.client_contact_id, ctx.tenantId],
    )
    if (contact.rowCount === 0) throw new Error('Unknown client contact.')

    // Idempotency: an existing mapping wins (re-invite, re-login, races) — but
    // the RBAC assignment still self-heals below (an actor provisioned before
    // the client.portal scope existed gets its rung on the next provision call).
    const existing = await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      p.client_contact_id,
      'portal_actor_id',
    )
    if (existing) {
      await ensureClientPortalScope(client, ctx.tenantId, actionId, existing)
      return { actorId: existing, clientContactId: p.client_contact_id, created: false }
    }

    const externalId = `client:${p.client_contact_id}`
    // A prior actor row without the attribute (crash between the two writes on a
    // previous attempt) is reused, not duplicated.
    const prior = await client.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id = $1 AND external_id = $2 AND status = 'active' LIMIT 1`,
      [ctx.tenantId, externalId],
    )
    let actorId = prior.rows[0]?.id
    if (!actorId) {
      actorId = randomUUID()
      const displayName = await contactDisplayName(client, ctx.tenantId, p.client_contact_id)
      // Direct actor INSERT is deliberate: actor is an identity table, not one of
      // the hard-rule-1 substrate fact tables, and every other actor row in the
      // system is created by seed/provisioning SQL. Doing it inside this handler
      // keeps the write in the action layer's transaction with full audit (the
      // action row + portal.account_created event below).
      await client.query(
        `INSERT INTO actor (id, tenant_id, actor_type, external_id, display_name, status)
       VALUES ($1, $2, 'human', $3, $4, 'active')`,
        [actorId, ctx.tenantId, externalId, displayName],
      )
    }

    // RBAC (0136): the client actor is a human actor, so it is scope-restricted
    // — assign the client.portal rung (the explicit portal-action allowlist) in
    // the same transaction. Direct insert for the same reason as the actor row:
    // assignments are identity plumbing, written with this action's provenance.
    await ensureClientPortalScope(client, ctx.tenantId, actionId, actorId)

    const attrKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'portal_actor_id',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.client_contact_id,
      attributeKindId: attrKindId,
      value: actorId,
      confidence: 1.0,
      sourceType: 'system',
      sourceRef: 'system:portal_account_provisioning',
    })

    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'portal.account_created',
      primaryEntityId: p.client_contact_id,
      data: {
        client_contact_id: p.client_contact_id,
        actor_id: actorId,
        trigger: p.trigger ?? 'invite',
      },
      sourceType: 'system',
      sourceRef: `client_contact:${p.client_contact_id}`,
    })

    // Account creation is a client delivery: advance any of the client's matters
    // parked on a client gate whose edge is `via: 'legal.client.provision_portal_actor'`
    // (the send_portal_invite stage). No-op for matters not parked there.
    for (const matterId of p.matter_entity_ids ?? []) {
      await dispatchClientDelivery(
        client,
        ctx,
        matterId,
        'legal.client.provision_portal_actor',
        actionId,
        `client_contact:${p.client_contact_id}`,
      )
    }

    return { actorId, clientContactId: p.client_contact_id, created: true }
  },
)

// N1 — portal.email_confirmed: the client proved control of their portal
// email. Idempotent the same way provision_portal_actor is: look for an
// existing event on this contact first (queried directly rather than via a
// dedicated attribute, since there is nothing else this event needs to key
// off of) and reuse it rather than writing a duplicate.
interface ConfirmEmailPayload {
  client_contact_id: string
}

registerActionHandler(
  'legal.client.confirm_portal_email',
  async (ctx, client, payload, actionId) => {
    const p = payload as unknown as ConfirmEmailPayload
    if (!p.client_contact_id) throw new Error('client_contact_id is required.')

    const existing = await client.query<{ id: string }>(
      `SELECT ev.id FROM event ev
       JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
       WHERE ev.tenant_id = $1 AND ekd.kind_name = 'portal.email_confirmed'
         AND ev.primary_entity_id = $2
       ORDER BY ev.occurred_at DESC LIMIT 1`,
      [ctx.tenantId, p.client_contact_id],
    )
    const existingId = existing.rows[0]?.id
    if (existingId) {
      return { eventId: existingId, clientContactId: p.client_contact_id }
    }

    const actorId = await getLatestAttributeValue<string>(
      client,
      ctx.tenantId,
      p.client_contact_id,
      'portal_actor_id',
    )

    const eventId = await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'portal.email_confirmed',
      primaryEntityId: p.client_contact_id,
      data: { client_contact_id: p.client_contact_id, actor_id: actorId },
      sourceType: 'human',
      sourceRef: `client_contact:${p.client_contact_id}`,
    })

    return { eventId, clientContactId: p.client_contact_id }
  },
)

// ── Fee consent ───────────────────────────────────────────────────────────────

export type FeeBasis = 'fixed' | 'hourly-rate' | 'review-fee' | 'consultation'
export type FeeSubjectKind =
  | 'service_booking'
  | 'scheduled_time'
  | 'document_review'
  | 'workflow_fee'

interface FeeQuotePayload {
  client_contact_id: string
  matter_entity_id?: string | null
  subject_kind: FeeSubjectKind
  subject_key: string
  amount?: string | null
  rate?: string | null
  duration_minutes?: number | null
  currency?: string
  basis: FeeBasis
  description?: string | null
}

const MONEY_RE = /^-?\d+(\.\d+)?$/

function assertQuoteTerms(p: FeeQuotePayload): void {
  if (!p.client_contact_id) throw new Error('client_contact_id is required.')
  if (!p.subject_kind?.trim() || !p.subject_key?.trim()) {
    throw new Error('subject_kind and subject_key are required.')
  }
  if (!p.basis?.trim()) throw new Error('basis is required.')
  const hasAmount = typeof p.amount === 'string' && MONEY_RE.test(p.amount)
  const hasRate = typeof p.rate === 'string' && MONEY_RE.test(p.rate)
  if (!hasAmount && !hasRate) {
    throw new Error('A fee quote needs an amount (fixed) or a rate (hourly), as a decimal string.')
  }
}

function quoteTerms(p: FeeQuotePayload): Record<string, unknown> {
  return {
    client_contact_id: p.client_contact_id,
    matter_entity_id: p.matter_entity_id ?? null,
    subject_kind: p.subject_kind,
    subject_key: p.subject_key,
    amount: p.amount ?? null,
    rate: p.rate ?? null,
    duration_minutes: p.duration_minutes ?? null,
    currency: p.currency ?? 'USD',
    basis: p.basis,
    description: p.description ?? null,
  }
}

registerActionHandler('legal.fee.quote', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as FeeQuotePayload
  assertQuoteTerms(p)
  const quoteEventId = await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'fee.quoted',
    primaryEntityId: p.matter_entity_id ?? p.client_contact_id,
    secondaryEntityIds: p.matter_entity_id ? [p.client_contact_id] : [],
    data: quoteTerms(p),
    sourceType: 'system',
    sourceRef: 'system:fee_quote',
  })
  return { quoteEventId }
})

interface FeeDecisionPayload extends FeeQuotePayload {
  quote_event_id: string
}

async function loadQuote(
  client: DbClient,
  tenantId: string,
  quoteEventId: string,
): Promise<{ id: string; payload: Record<string, unknown> } | null> {
  const res = await client.query<{ id: string; payload: Record<string, unknown> }>(
    `SELECT ev.id, ev.payload
     FROM event ev
     JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
     WHERE ev.id = $1 AND ev.tenant_id = $2 AND ekd.kind_name = 'fee.quoted'`,
    [quoteEventId, tenantId],
  )
  return res.rows[0] ?? null
}

function decisionHandler(eventKindName: 'fee.accepted' | 'fee.declined'): ActionEffectHandler {
  return async (ctx, client, payload, actionId) => {
    const p = payload as unknown as FeeDecisionPayload
    if (!p.quote_event_id) throw new Error('quote_event_id is required.')
    const quote = await loadQuote(client, ctx.tenantId, p.quote_event_id)
    if (!quote) throw new Error('Unknown fee quote.')
    const terms = quote.payload
    // The decision binds to the QUOTED terms (server truth) — never to anything
    // the client resent. The route has already verified the quote belongs to the
    // session's client.
    if (terms.client_contact_id !== p.client_contact_id) {
      throw new Error('This quote was not presented to this client.')
    }
    const consentEventId = await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName,
      primaryEntityId: (terms.matter_entity_id as string | null) ?? p.client_contact_id,
      secondaryEntityIds: terms.matter_entity_id ? [p.client_contact_id] : [],
      data: { ...terms, quote_event_id: p.quote_event_id },
      sourceType: 'human',
      sourceRef: `client_contact:${p.client_contact_id}`,
    })
    return { consentEventId, quoteEventId: p.quote_event_id, decision: eventKindName }
  }
}

registerActionHandler('legal.fee.accept', decisionHandler('fee.accepted'))
registerActionHandler('legal.fee.decline', decisionHandler('fee.declined'))
