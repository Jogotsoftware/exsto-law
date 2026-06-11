// Granola ingestion pipeline (Phase 0, WP3 — REQ-CALL-01..04, REQ-INT-01..03):
//
//   webhook (thin, signature-verified, fast-ack)
//     → raw_event.ingest          (raw payload → raw_event_log, invariant 14)
//     → enqueue legal.granola.project
//   worker: legal.granola.project
//     → normalize payload / fetch transcript via Granola API
//     → match matter (booking time window + attendee email)
//     → call.ingest               (call_session + transcript projection)
//
// Tenant is resolved SERVER-SIDE (single-firm Phase 0: tenant zero) — never
// from the webhook payload. Unmatched transcripts project with a null matter
// and surface in the review queue (call_sessions without call_of), never the void.
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { enqueueJob } from '@exsto/worker-runtime'
import {
  fetchGranolaCall,
  normalizeGranolaPayload,
  granolaWebhookSecret,
  verifyGranolaSignature,
  type GranolaCallData,
} from '../adapters/granola.js'

const TENANT_ZERO = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const SYSTEM_ACTOR = '00000000-0000-0000-0001-000000000001'

export function ingestionContext(): ActionContext {
  return { tenantId: TENANT_ZERO, actorId: SYSTEM_ACTOR }
}

// Strict matching: attendee email must match a client_of contact AND the call
// must start within ±90 minutes of the matter's scheduled consultation.
// Wrong-matter attachment is worse than unmatched in a legal product, so there
// is deliberately no looser fallback.
export async function matchMatterForCall(
  ctx: ActionContext,
  data: GranolaCallData,
): Promise<string | null> {
  if (!data.startedAt || data.attendeeEmails.length === 0) return null
  const emails = data.attendeeEmails.map((e) => e.toLowerCase())
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT e.id
       FROM entity e
       JOIN entity_kind_definition ekd
         ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'matter'
       JOIN relationship r
         ON r.target_entity_id = e.id AND r.tenant_id = e.tenant_id
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
       JOIN attribute a
         ON a.entity_id = r.source_entity_id AND a.tenant_id = e.tenant_id
       JOIN attribute_kind_definition akd
         ON akd.id = a.attribute_kind_id AND akd.kind_name = 'email'
       WHERE e.tenant_id = $1
         AND e.status = 'active'
         AND lower(a.value #>> '{}') = ANY($2)
         AND (e.metadata->>'scheduled_at') IS NOT NULL
         AND abs(extract(epoch FROM ((e.metadata->>'scheduled_at')::timestamptz - $3::timestamptz))) <= 5400
       ORDER BY abs(extract(epoch FROM ((e.metadata->>'scheduled_at')::timestamptz - $3::timestamptz)))
       LIMIT 1`,
      [ctx.tenantId, emails, data.startedAt],
    )
    return res.rows[0]?.id ?? null
  })
}

// Project normalized call data into the substrate via call.ingest.
export async function projectGranolaCall(
  ctx: ActionContext,
  data: GranolaCallData,
  opts: { source: 'granola' | 'stub' | 'manual'; rawEventLogId?: string | null },
): Promise<ActionResult> {
  const matterId = await matchMatterForCall(ctx, data)
  return submitAction(ctx, {
    actionKindName: 'call.ingest',
    intentKind: 'automatic_sync',
    payload: {
      granola_call_id: data.callId,
      matter_entity_id: matterId,
      started_at: data.startedAt,
      ended_at: data.endedAt,
      duration_seconds: data.durationSeconds,
      transcript_text: data.transcriptText,
      transcript_source: opts.source,
      notes: data.notes,
      attendee_emails: data.attendeeEmails,
      raw_event_log_id: opts.rawEventLogId ?? null,
    },
  })
}

// The worker-side projection: payload comes from the webhook (raw body already
// in raw_event_log). If the payload lacks transcript content, fetch it via the
// Granola API (REQ-CALL-02). On auto-route (single-member) matters, a matched
// transcript triggers the async drafting jobs (OA + engagement letter).
export async function runGranolaProjection(
  ctx: ActionContext,
  jobPayload: { raw_event_log_id?: string | null; payload: Record<string, unknown> },
): Promise<void> {
  let data = normalizeGranolaPayload(jobPayload.payload)
  if (!data) {
    const callId =
      (jobPayload.payload.call_id as string | undefined) ??
      (jobPayload.payload.id as string | undefined)
    if (!callId) {
      throw new Error('Granola payload had neither transcript content nor a call id')
    }
    data = await fetchGranolaCall(ctx.tenantId, callId)
  }
  const result = await projectGranolaCall(ctx, data, {
    source: 'granola',
    rawEventLogId: jobPayload.raw_event_log_id ?? null,
  })

  const effects = (result.effects[0] ?? {}) as { matched?: boolean; deduplicated?: boolean }
  if (effects.matched && !effects.deduplicated) {
    const matterId = await matchMatterForCall(ctx, data)
    if (matterId) await enqueueAutoDrafts(ctx, matterId)
  }
}

// Single-member (auto-route) matters get their drafts queued the moment the
// transcript lands (REQ-DRAFT-01/05). Manual-route matters get nothing here —
// the attorney email is their path (WP6).
async function enqueueAutoDrafts(ctx: ActionContext, matterEntityId: string): Promise<void> {
  const route = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ route: string | null }>(
      `SELECT e.metadata->>'workflow_route' AS route FROM entity e
       WHERE e.tenant_id = $1 AND e.id = $2`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows[0]?.route ?? null
  })
  if (route !== 'auto') return

  const { requestDraft } = await import('./generateDraft.js')
  for (const documentKind of ['operating_agreement', 'engagement_letter'] as const) {
    await requestDraft(ctx, { matterEntityId, documentKind })
  }
}

export interface WebhookResult {
  ok: boolean
  status: number
  error?: string
  rawEventLogId?: string
  jobId?: string
}

// Thin webhook entry: verify → raw_event_log → enqueue → ack. Anything slow
// (API fetch, projection) happens in the worker.
export async function handleGranolaWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookResult> {
  const ctx = ingestionContext()
  const secret = await granolaWebhookSecret(ctx.tenantId)
  if (!secret) {
    return { ok: false, status: 503, error: 'Granola webhook secret not configured' }
  }
  if (!verifyGranolaSignature(rawBody, signatureHeader, secret)) {
    return { ok: false, status: 401, error: 'invalid signature' }
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    return { ok: false, status: 400, error: 'invalid JSON' }
  }
  const externalId =
    (payload.call_id as string | undefined) ?? (payload.id as string | undefined) ?? null

  const raw = await submitAction(ctx, {
    actionKindName: 'raw_event.ingest',
    intentKind: 'automatic_sync',
    payload: {
      source_type: 'integration',
      source_ref: 'integration:granola',
      external_id: externalId,
      payload,
    },
  })
  const rawEffects = (raw.effects[0] ?? {}) as { rawEventLogId?: string }

  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: 'legal.granola.project',
    payload: { raw_event_log_id: rawEffects.rawEventLogId ?? null, payload },
  })

  return { ok: true, status: 200, rawEventLogId: rawEffects.rawEventLogId, jobId }
}
