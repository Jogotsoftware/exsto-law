import { withActionContext, type ActionContext } from '@exsto/substrate'
import { getService } from './services.js'
import { getFirmDefaultRate, getClientRate } from './rates.js'
import {
  presentFeeQuote,
  decideFeeQuote,
  findFeeConsent,
  type FeeConsentRecord,
} from './feeConsent.js'

// PORTAL-1 (WP3/WP4) — fee consent for booking a service, shared by the
// anonymous intake-gate finalize and the signed-in portal booking endpoint.
// Law 2: the exact cost is shown and explicitly accepted BEFORE the booking
// proceeds; the gate is server-side (assert…), never the UI.

export interface ServiceFeeQuote {
  subjectKind: 'service_booking'
  subjectKey: string
  basis: 'fixed' | 'hourly-rate'
  /** Decimal string for fixed services. */
  amount: string | null
  /** Decimal string — the governing rate for hourly services. */
  rate: string | null
  currency: 'USD'
  description: string
}

// The client-parent account this contact belongs to (contact_of), for the
// Contract-K client-rate lookup. Null for a brand-new lead with no parent yet.
async function resolveClientParentId(
  ctx: ActionContext,
  clientContactId: string,
): Promise<string | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2
         AND rkd.kind_name = 'contact_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.recorded_at DESC LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    return res.rows[0]?.id ?? null
  })
}

// What booking this service costs THIS client, or null when the service
// declares no cost (no consent friction on non-billable acts). Fixed services
// quote the exact amount; hourly services quote the governing rate (Contract K:
// client rate → firm default).
export async function resolveServiceFeeQuote(
  ctx: ActionContext,
  serviceKey: string,
  clientContactId: string | null,
): Promise<ServiceFeeQuote | null> {
  const service = await getService(ctx, serviceKey)
  if (!service) throw new Error(`Unknown service: ${serviceKey}`)
  const cost = service.cost
  if (!cost) return null
  if (cost.type === 'fixed' && cost.amount) {
    return {
      subjectKind: 'service_booking',
      subjectKey: serviceKey,
      basis: 'fixed',
      amount: cost.amount,
      rate: null,
      currency: 'USD',
      description: `${service.displayName} — fixed fee`,
    }
  }
  if (cost.type === 'hourly') {
    // Governing rate: the service's own declared hourly amount, else Contract K
    // (client rate → firm default).
    let rate: string | null = cost.amount ?? null
    if (!rate) {
      const parentId = clientContactId ? await resolveClientParentId(ctx, clientContactId) : null
      rate = parentId ? await getClientRate(ctx, parentId) : await getFirmDefaultRate(ctx)
    }
    if (!rate) return null // no governing rate configured — nothing to quote, honestly
    return {
      subjectKind: 'service_booking',
      subjectKey: serviceKey,
      basis: 'hourly-rate',
      amount: null,
      rate,
      currency: 'USD',
      description: `${service.displayName} — billed hourly at the governing rate`,
    }
  }
  return null
}

// Record the presented quote + the client's acceptance, as the client's OWN
// actor. `clientActorCtx.actorId` MUST be the client's portal actor.
export async function grantServiceFeeConsent(
  clientActorCtx: ActionContext,
  input: { clientContactId: string; matterEntityId?: string | null; quote: ServiceFeeQuote },
): Promise<{ consentEventId: string }> {
  const { quote } = input
  const { quoteEventId } = await presentFeeQuote(clientActorCtx, {
    clientContactId: input.clientContactId,
    matterEntityId: input.matterEntityId ?? null,
    subjectKind: quote.subjectKind,
    subjectKey: quote.subjectKey,
    amount: quote.amount,
    rate: quote.rate,
    currency: quote.currency,
    basis: quote.basis,
    description: quote.description,
  })
  return decideFeeQuote(clientActorCtx, {
    clientContactId: input.clientContactId,
    quoteEventId,
    decision: 'accept',
  })
}

// The server-side gate before booking.create: a matching acceptance must exist.
export async function findServiceFeeConsent(
  ctx: ActionContext,
  clientContactId: string,
  quote: ServiceFeeQuote,
): Promise<FeeConsentRecord | null> {
  return findFeeConsent(ctx, {
    clientContactId,
    subjectKind: quote.subjectKind,
    subjectKey: quote.subjectKey,
    amount: quote.amount,
    rate: quote.rate,
  })
}
