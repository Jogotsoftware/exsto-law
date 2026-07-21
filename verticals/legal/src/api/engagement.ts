import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  readEngagementTerms,
  readEngagementTemplate,
  type EngagementTermsValue,
  type EngagementTemplateValue,
} from '../handlers/engagement.js'
import { getFirmDefaultRate } from './rates.js'

// CLIENT-PORTAL-UI-1 (WP-6) — the firm-level engagement agreement, API surface.
// One agreement per client: sign once, messaging + booking unlock and stay
// unlocked. The gate is SERVER-SIDE (assertEngagementAccepted at the operation
// core — postClientMessage, scheduleClientTime); the portal's locked rail card
// is only the honest presentation of it, mounting the same FeeConsentCard the
// booking flow uses. Per-quote service-fee consent (api/feeConsent.ts) is a
// separate, unchanged contract.

export interface EngagementConfig {
  /** The firm standard hourly rate (firm_default_hourly_rate), decimal string. */
  rate: string | null
  termsText: string | null
  termsVersion: number | null
  /** True when both a rate and published terms exist — the gate can be offered. */
  configured: boolean
}

export interface EngagementStatus {
  accepted: boolean
  acceptedAt: string | null
  /** The rate/terms version the acceptance bound to (from the consent receipt). */
  rate: string | null
  termsVersion: number | null
}

export async function getEngagementConfig(ctx: ActionContext): Promise<EngagementConfig> {
  const [rate, terms] = await Promise.all([
    getFirmDefaultRate(ctx),
    withActionContext(ctx, (client) => readEngagementTerms(client, ctx.tenantId)),
  ])
  return {
    rate,
    termsText: terms?.text ?? null,
    termsVersion: terms?.version ?? null,
    configured: Boolean(rate && terms),
  }
}

// The newest engagement decision by THIS client. Acceptance wins only when it is
// the LATEST decision — a later decline re-locks nothing today (decline is only
// recorded pre-acceptance), but reading latest-decision keeps the truth simple.
export async function getEngagementStatus(
  ctx: ActionContext,
  clientContactId: string,
): Promise<EngagementStatus> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      kind_name: string
      payload: Record<string, unknown>
      recorded_at: string
    }>(
      `SELECT ekd.kind_name, ev.payload, ev.recorded_at::text AS recorded_at
       FROM event ev
       JOIN event_kind_definition ekd ON ekd.id = ev.event_kind_id
       WHERE ev.tenant_id = $1
         AND ekd.kind_name = 'engagement.accepted'
         AND ev.payload ->> 'client_contact_id' = $2
       ORDER BY ev.recorded_at DESC
       LIMIT 1`,
      [ctx.tenantId, clientContactId],
    )
    const row = res.rows[0]
    if (!row) return { accepted: false, acceptedAt: null, rate: null, termsVersion: null }
    return {
      accepted: true,
      acceptedAt: row.recorded_at,
      rate: (row.payload.rate as string | null) ?? null,
      termsVersion: (row.payload.terms_version as number | null) ?? null,
    }
  })
}

// Thrown at the operation core when a client-initiated message/booking arrives
// with no accepted engagement. Client-safe message; the tool layer surfaces the
// current config so the UI can render the gate card without a second call.
export class EngagementRequiredError extends Error {
  config: EngagementConfig
  constructor(config: EngagementConfig) {
    super('Please review and accept the engagement terms first — then this unlocks.')
    this.name = 'EngagementRequiredError'
    this.config = config
  }
}

export async function assertEngagementAccepted(
  ctx: ActionContext,
  clientContactId: string,
): Promise<EngagementStatus> {
  const status = await getEngagementStatus(ctx, clientContactId)
  if (!status.accepted) {
    throw new EngagementRequiredError(await getEngagementConfig(ctx))
  }
  return status
}

// ctx MUST be the client's own actor context (the authed route builds it from
// the session) — the acceptance is the client's own act on the ledger. The
// handler resolves the CURRENT rate + terms version server-side; input carries
// only the contact id the route stamped.
export async function acceptEngagement(
  ctx: ActionContext,
  clientContactId: string,
  // ENGAGEMENT-DOC-1 — the typed signature; the handler requires it iff the
  // firm has an engagement-agreement template configured.
  signedName?: string,
): Promise<{ consentEventId: string; rate: string | null; termsVersion: number | null }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.engagement.accept',
    intentKind: 'enforcement',
    payload: { client_contact_id: clientContactId, signed_name: signedName },
  })
  return res.effects[0] as {
    consentEventId: string
    rate: string | null
    termsVersion: number | null
  }
}

export async function declineEngagement(
  ctx: ActionContext,
  clientContactId: string,
): Promise<{ consentEventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.engagement.decline',
    intentKind: 'enforcement',
    payload: { client_contact_id: clientContactId },
  })
  return res.effects[0] as { consentEventId: string }
}

// Attorney publishes/updates the terms (version bumps server-side).
export async function setEngagementTerms(
  ctx: ActionContext,
  text: string,
): Promise<{ version: number }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.firm.set_engagement_terms',
    intentKind: 'adjustment',
    payload: { text },
  })
  return res.effects[0] as { version: number }
}

// ENGAGEMENT-DOC-1 — attorney points the firm at (or clears) the engagement
// agreement template produced by the settings upload/parse pipeline.
export async function setEngagementTemplate(
  ctx: ActionContext,
  input: {
    templateId: string | null
    sourceFilename?: string
    details?: Record<string, unknown>
  },
): Promise<{ templateId: string | null; version?: number }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.firm.set_engagement_template',
    intentKind: 'adjustment',
    payload: {
      template_id: input.templateId,
      source_filename: input.sourceFilename,
      details: input.details,
    },
  })
  const eff = res.effects[0] as { template_id: string | null; version?: number }
  return { templateId: eff.template_id, version: eff.version }
}

export async function getEngagementTemplate(
  ctx: ActionContext,
): Promise<EngagementTemplateValue | null> {
  return withActionContext(ctx, (client) => readEngagementTemplate(client, ctx.tenantId))
}

export type { EngagementTermsValue, EngagementTemplateValue }
