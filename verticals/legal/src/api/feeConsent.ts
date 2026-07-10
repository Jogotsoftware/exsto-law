import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import type { FeeBasis, FeeSubjectKind } from '../handlers/clientPortalActor.js'

// PORTAL-1 (WP3) — universal fee consent. Law 2: nothing billable proceeds
// unconsented. A quote is presented (fee.quoted), the client's own actor accepts
// (fee.accepted) or declines, and the billable act is gated SERVER-SIDE on the
// acceptance existing — assertFeeConsent at the act, never in the UI.

export type { FeeBasis, FeeSubjectKind }

export interface FeeQuoteInput {
  clientContactId: string
  matterEntityId?: string | null
  subjectKind: FeeSubjectKind
  /** What the consent binds to, e.g. the serviceKey or 'scheduled_time:<startIso>'. */
  subjectKey: string
  /** Decimal string for fixed quotes. */
  amount?: string | null
  /** Decimal string for hourly quotes (the governing rate). */
  rate?: string | null
  durationMinutes?: number | null
  currency?: string
  basis: FeeBasis
  description?: string | null
}

export async function presentFeeQuote(
  ctx: ActionContext,
  input: FeeQuoteInput,
): Promise<{ quoteEventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.fee.quote',
    intentKind: 'enforcement',
    payload: {
      client_contact_id: input.clientContactId,
      matter_entity_id: input.matterEntityId ?? null,
      subject_kind: input.subjectKind,
      subject_key: input.subjectKey,
      amount: input.amount ?? null,
      rate: input.rate ?? null,
      duration_minutes: input.durationMinutes ?? null,
      currency: input.currency ?? 'USD',
      basis: input.basis,
      description: input.description ?? null,
    },
  })
  return res.effects[0] as { quoteEventId: string }
}

// The client decides. ctx.actorId MUST be the client's own portal actor — the
// route derives it from the session; this module never accepts an actor from
// input. The handler re-verifies the quote was presented to this contact.
export async function decideFeeQuote(
  ctx: ActionContext,
  input: { clientContactId: string; quoteEventId: string; decision: 'accept' | 'decline' },
): Promise<{ consentEventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: input.decision === 'accept' ? 'legal.fee.accept' : 'legal.fee.decline',
    intentKind: 'enforcement',
    payload: {
      client_contact_id: input.clientContactId,
      quote_event_id: input.quoteEventId,
    },
  })
  return res.effects[0] as { consentEventId: string }
}

export interface FeeConsentQuery {
  clientContactId: string
  subjectKind: FeeSubjectKind
  subjectKey: string
  /** When given, the acceptance must match this exact amount (fixed quotes). */
  amount?: string | null
  /** When given, the acceptance must match this exact rate (hourly quotes). */
  rate?: string | null
}

export interface FeeConsentRecord {
  consentEventId: string
  quoteEventId: string | null
  amount: string | null
  rate: string | null
  basis: string
  acceptedAt: string
}

// The newest fee.accepted event by THIS client for THIS subject (and, when the
// caller pins them, the exact amount/rate). Reads through the action context —
// tenant-scoped by RLS.
export async function findFeeConsent(
  ctx: ActionContext,
  q: FeeConsentQuery,
): Promise<FeeConsentRecord | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      payload: Record<string, unknown>
      recorded_at: string
    }>(
      `SELECT ev.id, ev.payload, ev.recorded_at::text AS recorded_at
       FROM event ev
       JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
       WHERE ev.tenant_id = $1 AND ekd.kind_name = 'fee.accepted'
         AND ev.payload ->> 'client_contact_id' = $2
         AND ev.payload ->> 'subject_kind' = $3
         AND ev.payload ->> 'subject_key' = $4
         AND ($5::text IS NULL OR ev.payload ->> 'amount' = $5)
         AND ($6::text IS NULL OR ev.payload ->> 'rate' = $6)
       ORDER BY ev.recorded_at DESC
       LIMIT 1`,
      [
        ctx.tenantId,
        q.clientContactId,
        q.subjectKind,
        q.subjectKey,
        q.amount ?? null,
        q.rate ?? null,
      ],
    )
    const row = res.rows[0]
    if (!row) return null
    return {
      consentEventId: row.id,
      quoteEventId: (row.payload.quote_event_id as string | null) ?? null,
      amount: (row.payload.amount as string | null) ?? null,
      rate: (row.payload.rate as string | null) ?? null,
      basis: String(row.payload.basis ?? ''),
      acceptedAt: row.recorded_at,
    }
  })
}

// The server-side gate. Throws a client-safe error when no matching acceptance
// exists — the billable act must not proceed.
export async function assertFeeConsent(
  ctx: ActionContext,
  q: FeeConsentQuery,
): Promise<FeeConsentRecord> {
  const consent = await findFeeConsent(ctx, q)
  if (!consent) {
    throw new Error('This has a cost that needs your acceptance first. Please review the fee and accept it to continue.')
  }
  return consent
}

// Attorney-side: the consent trail for a matter (accepted AND declined), newest
// first — rendered next to the fees it authorized in the billing panel.
export interface FeeConsentTrailEntry {
  eventId: string
  decision: 'accepted' | 'declined' | 'quoted'
  clientContactId: string
  subjectKind: string
  subjectKey: string
  amount: string | null
  rate: string | null
  durationMinutes: number | null
  basis: string
  description: string | null
  at: string
}

export async function listFeeConsentTrail(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<FeeConsentTrailEntry[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      id: string
      kind_name: string
      payload: Record<string, unknown>
      recorded_at: string
    }>(
      `SELECT ev.id, ekd.kind_name, ev.payload, ev.recorded_at::text AS recorded_at
       FROM event ev
       JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
       WHERE ev.tenant_id = $1
         AND ekd.kind_name IN ('fee.quoted', 'fee.accepted', 'fee.declined')
         AND (ev.primary_entity_id = $2 OR ev.payload ->> 'matter_entity_id' = $2)
       ORDER BY ev.recorded_at DESC
       LIMIT 100`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map((row) => ({
      eventId: row.id,
      decision:
        row.kind_name === 'fee.accepted'
          ? ('accepted' as const)
          : row.kind_name === 'fee.declined'
            ? ('declined' as const)
            : ('quoted' as const),
      clientContactId: String(row.payload.client_contact_id ?? ''),
      subjectKind: String(row.payload.subject_kind ?? ''),
      subjectKey: String(row.payload.subject_key ?? ''),
      amount: (row.payload.amount as string | null) ?? null,
      rate: (row.payload.rate as string | null) ?? null,
      durationMinutes: (row.payload.duration_minutes as number | null) ?? null,
      basis: String(row.payload.basis ?? ''),
      description: (row.payload.description as string | null) ?? null,
      at: row.recorded_at,
    }))
  })
}
