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
// Tenant is resolved SERVER-SIDE — never from the webhook payload. SECOND-FIRM-1:
// the single global webhook endpoint carries no tenant hint, so the tenant is
// resolved by FOLLOWING THE DATA — Granola is connected per-attorney per-tenant
// (migration 0016), each connection carries its own webhook secret, and the
// tenant(s) whose secret verifies the HMAC signature own the event. Unmatched
// transcripts project with a null matter and surface in the review queue
// (call_sessions without call_of), never the void.
import { withTenant } from '@exsto/shared'
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
import { listConnectedTenants, resolveFirmPrimaryActor } from '../adapters/connectionStore.js'

// Historical single-firm pins — kept ONLY for (a) the tenant-zero actor
// preference below (unchanged attribution for tenant zero's history) and
// (b) the explicit last-resort context for the dormant external e-sign
// callback, which still has no tenant signal of any kind.
const TENANT_ZERO = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'
const LEGACY_SYSTEM_ACTOR = '00000000-0000-0000-0001-000000000001'

// The tenant's own ingestion system actor: the historical …0001 when it exists
// in this tenant (tenant zero — attribution unchanged), else the tenant's own
// system/agent actor. withTenant (not withActionContext): the actor is what we
// are resolving, so there is no ActionContext yet — same bootstrap shape as
// resolvePublicIntakeActor. Fails closed: tenant-zero's actor id has no row in
// any other tenant, so returning it would only FK-fail the ingest downstream.
async function resolveIngestionActor(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM actor
        WHERE tenant_id = $1 AND status = 'active'
          AND (id = $2 OR actor_type IN ('system', 'agent'))
        ORDER BY (id = $2) DESC,
                 CASE actor_type WHEN 'system' THEN 0 ELSE 1 END, created_at
        LIMIT 1`,
      [tenantId, LEGACY_SYSTEM_ACTOR],
    )
    const id = res.rows[0]?.id
    if (!id) {
      throw new Error(
        `No active system/agent actor in tenant ${tenantId} — seed one before ingesting integrations.`,
      )
    }
    return id
  })
}

// SECOND-FIRM-1: the ingestion context is now PER-TENANT (tenant id + that
// tenant's own system actor), never a module-level tenant-zero pin.
export async function ingestionContext(tenantId: string): Promise<ActionContext> {
  return { tenantId, actorId: await resolveIngestionActor(tenantId) }
}

// LAST-RESORT ONLY. The dormant external e-sign provider callback
// (handleEsignCallback, esign.ts — no live provider configured) arrives with no
// tenant signal at all: no slug, no signed token, and no per-tenant secret to
// follow. Until that path grows a real tenant resolution (it must, before an
// external provider goes live), it stays on the historical tenant-zero pin —
// EXPLICITLY and LOUDLY, never as a silent default. Do not add new callers.
export function lastResortTenantZeroContext(caller: string): ActionContext {
  console.warn(
    `[ingestion] ${caller}: no tenant signal — falling back to tenant zero (${TENANT_ZERO}). ` +
      'This is a single-firm legacy pin; wire real tenant resolution before multi-firm use.',
  )
  return { tenantId: TENANT_ZERO, actorId: LEGACY_SYSTEM_ACTOR }
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
    // Granola is per-attorney (migration 0016). The push/webhook pipeline has no
    // signed-in attorney, so it uses the firm's primary Granola connection.
    const granolaActor = await resolveFirmPrimaryActor(ctx.tenantId, 'granola')
    data = await fetchGranolaCall(ctx.tenantId, callId, granolaActor)
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

// Auto-route matters get their drafts queued the moment the transcript lands
// (REQ-DRAFT-01/05). The set of documents to draft is config-as-data: it is the
// service's transitions.documents, with NO hardcoded allow-list of kinds (Doc-Types
// PR1) — so a service configured with a novel kind (NDA, amendment, …) drafts it
// just like the bundled kinds. This is safe because the completeness gate blocks
// enabling an auto service unless every configured kind has a drafting prompt and a
// resolvable body template; a matter only reaches here when its service is auto.
// Manual-route matters get nothing here — the attorney email is their path (WP6).
export async function enqueueAutoDrafts(ctx: ActionContext, matterEntityId: string): Promise<void> {
  const matterRoute = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ service_key: string | null }>(
      `SELECT (SELECT a.value #>> '{}'
                 FROM attribute a
                 JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND akd.kind_name = 'service_key'
                ORDER BY a.valid_from DESC LIMIT 1) AS service_key
         FROM entity e
        WHERE e.tenant_id = $1 AND e.id = $2`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows[0] ?? null
  })

  // Auto-draft is now data-driven (ADR 0045): this transcript-ingest hook drafts
  // automatically iff the service's lifecycle has an automatic transition out of the
  // `consulted` stage (the stage a matter is in when its transcript lands). That edge
  // is `automatic` exactly for auto-route services — so this is the data-defined
  // equivalent of the old `route === 'auto'` check, with NO behavior change, and it
  // honors an attorney's edited lifecycle (PR4) once states is populated.
  const { getService, resolveServiceLifecycle } = await import('./services.js')
  const { hasAutomaticTransition } = await import('../lifecycle/index.js')
  const lifecycle = matterRoute?.service_key
    ? await resolveServiceLifecycle(ctx, matterRoute.service_key)
    : null
  if (!lifecycle || !hasAutomaticTransition(lifecycle, 'consulted')) return

  // Resolve the document kinds from the service config. Fall back to the OA when
  // the service is auto but lists no documents, so an auto service is never silent.
  const service = matterRoute?.service_key ? await getService(ctx, matterRoute.service_key) : null
  const configured = service?.documents ?? []
  const documentKinds = configured.length > 0 ? configured : ['operating_agreement']

  const { requestDraft } = await import('./generateDraft.js')
  for (const documentKind of documentKinds) {
    await requestDraft(ctx, {
      matterEntityId,
      documentKind,
    })
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
//
// SECOND-FIRM-1: one global endpoint, N firms. The payload carries no tenant
// hint, so the tenant is resolved from the DATA the webhook already depends on:
// every tenant with an active Granola connection has its own webhook secret
// (per-connection Vault record; the GRANOLA_WEBHOOK_SECRET env var is the
// legacy single-firm fallback), and the tenant(s) whose secret verifies the
// signature own the event. Normally exactly one tenant matches; if several
// share the legacy env secret each ingests, and matching (attendee email +
// booking window) sorts the call into the right matter — an unmatched copy
// lands visibly in that firm's review queue, never silently in the wrong
// matter and never silently in the dev tenant.
export async function handleGranolaWebhook(
  rawBody: string,
  signatureHeader: string | null,
): Promise<WebhookResult> {
  const tenantIds = await listConnectedTenants('granola')
  let anySecret = false
  const matched: string[] = []
  for (const tenantId of tenantIds) {
    // Granola is per-attorney (migration 0016); the endpoint verifies against
    // the firm's primary connection's secret, per tenant.
    const granolaActor = await resolveFirmPrimaryActor(tenantId, 'granola')
    const secret = await granolaWebhookSecret(tenantId, granolaActor)
    if (!secret) continue
    anySecret = true
    if (verifyGranolaSignature(rawBody, signatureHeader, secret)) matched.push(tenantId)
  }
  if (!anySecret) {
    return { ok: false, status: 503, error: 'Granola webhook secret not configured' }
  }
  if (matched.length === 0) {
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

  let first: { rawEventLogId?: string; jobId?: string } | null = null
  for (const tenantId of matched) {
    const ctx = await ingestionContext(tenantId)
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
    first ??= { rawEventLogId: rawEffects.rawEventLogId, jobId }
  }

  return { ok: true, status: 200, rawEventLogId: first?.rawEventLogId, jobId: first?.jobId }
}
