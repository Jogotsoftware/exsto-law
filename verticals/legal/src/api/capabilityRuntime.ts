// ADR 0046 — the CAPABILITY RUNTIME. The `invoke_capability` step kind is the one
// open-ended workflow step: what it DOES is resolved from the platform capability
// registry at run time, not from a hardcoded executor branch. This module is that
// resolver + the small registry of real handler implementations.
//
// Execution model (deliberate, matches the rest of the engine): a step action is
// TRIGGERED, never auto-run inside the advance transaction. `generate_document` is
// run by the attorney's matter Workflow window; likewise an `invoke_capability`
// stage PARKS when the matter reaches it and runs when triggered — by the Workflow
// window's "Run" affordance in production, or directly by a caller here. No LLM call
// or job enqueue ever rides a lifecycle-advance transaction.
//
// After a capability runs, the matter waits at the capability's GATE:
//   • attorney → the produced artifact sits in the review queue; draft.approve
//     advances the instance (handlers/draft.advanceInstanceOnApprove).
//   • client   → the stage parks until the client's own delivery (upload / portal
//     message) advances it (lifecycle/executor.dispatchClientDelivery).
//   • automatic/system → the runtime advances the matter itself via the audited
//     legal.matter.advance path (agent actor).
//
// A capability with NO registered handler raises a clear, visible error and records
// an observation — never a silent no-op, never simulated output (the no-simulate
// contract, hardening 1.1 WP10).
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { listCapabilities, type Capability } from '../queries/capabilities.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { allowedTransitions, stageByKey } from '../lifecycle/resolve.js'
import type { CapabilityStepConfig } from '../lifecycle/types.js'
import { listMatterDocuments } from './documentUpload.js'
import { runDocumentReview } from './reviewDocument.js'

// The AI agent actor seeded by the core foundation — the runtime records its audit
// and any AI writes as this actor (same id every AI write in the vertical uses).
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// A capability was invoked but the platform has no executable implementation for it
// (it is contracted but not yet built, or not step-invocable). Surfaced to the
// caller as a visible error; the runtime also records an observation.
export class CapabilityNotExecutableError extends Error {}

// A capability ran but a REQUIRED input was not available yet (e.g. asked to review a
// document before the client uploaded one). Distinct from NotExecutable: the
// capability IS built, its precondition just is not met.
export class CapabilityInputMissingError extends Error {}

// Storage access is injected so the review handler stays testable with fakes (the
// same contract runDocumentReview follows). Production passes the real read-only
// adapter; tests pass a fake that returns the document bytes directly.
export interface CapabilityRuntimeDeps {
  downloadObject: (objectKey: string) => Promise<Buffer>
}

async function defaultDeps(): Promise<CapabilityRuntimeDeps> {
  const { downloadMatterDocument } = await import('../adapters/storage.js')
  return { downloadObject: downloadMatterDocument }
}

export interface CapabilityOutputRef {
  entityKind: string
  entityId?: string
  note?: string
}

export interface CapabilityHandlerContext {
  agentCtx: ActionContext
  matterEntityId: string
  serviceKey: string
  capabilitySlug: string
  config: Record<string, unknown>
  deps: CapabilityRuntimeDeps
}

export interface CapabilityHandlerResult {
  outputs: CapabilityOutputRef[]
  summary: string
}

type CapabilityHandler = (h: CapabilityHandlerContext) => Promise<CapabilityHandlerResult>

// ── The registry of REAL implementations, keyed by the capability's handler_key ──
// A capability's spec.handler_key names its entry here. A step-invocable capability
// whose handler_key is absent from this map is contracted-but-not-executable.
const CAPABILITY_HANDLERS: Record<string, CapabilityHandler> = {
  'legal.capability.ai_document_review.run': runAiDocumentReviewCapability,
  'legal.capability.request_client_materials.run': runRequestClientMaterialsCapability,
}

export function isHandlerImplemented(handlerKey: string | undefined): boolean {
  return !!handlerKey && handlerKey in CAPABILITY_HANDLERS
}

export interface InvokeCapabilityResult {
  ran: boolean
  capabilitySlug: string
  handlerKey: string
  gate: string
  advanced: boolean
  outputs: CapabilityOutputRef[]
  summary: string
}

// Run the capability the matter's CURRENT stage points at. The matter must be parked
// on an `invoke_capability` stage; the stage's StepAction.config names the capability
// (slug) and carries the attorney's standing config. Resolves the handler, runs it,
// records a `capability.invoked` audit event, and applies the capability's gate.
export async function invokeCapabilityForMatter(
  ctx: ActionContext,
  matterEntityId: string,
  deps?: CapabilityRuntimeDeps,
): Promise<InvokeCapabilityResult> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }

  // 1. Resolve the matter's current stage + its capability config (read-only).
  const stageInfo = await withActionContext(ctx, async (client) => {
    const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
    if (!instance) return null
    let graph =
      instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
    if (graph.length === 0) {
      const bound = await resolveBoundWorkflowById(
        client,
        ctx.tenantId,
        instance.workflowDefinitionId,
      )
      graph = bound?.graph ?? []
    }
    const stage = stageByKey(graph, instance.currentState)
    return { currentState: instance.currentState, stage }
  })
  if (!stageInfo || !stageInfo.stage) {
    throw new CapabilityNotExecutableError(
      `Matter ${matterEntityId} has no running workflow stage to invoke a capability on.`,
    )
  }
  const stage = stageInfo.stage
  if (stage.action?.kind !== 'invoke_capability') {
    throw new CapabilityNotExecutableError(
      `Stage "${stage.key}" is not an invoke_capability step (it is "${stage.action?.kind ?? 'none'}").`,
    )
  }
  const stepConfig = (stage.action.config ?? {}) as unknown as CapabilityStepConfig
  const slug = (stepConfig.capability_slug ?? '').trim()
  if (!slug) {
    throw new CapabilityNotExecutableError(
      `Stage "${stage.key}" is an invoke_capability step but names no capability_slug.`,
    )
  }

  // WP2 IDEMPOTENCY (both the auto-run and the manual route funnel through here, so
  // ONE guard covers both): a (matter, stage) invokes at most once. `capability.invoked`
  // is recorded ONLY on success (step 4 below), so a prior SUCCESS blocks a re-run —
  // an advance + a stray manual call, or two advances, can't double-fire (no double
  // memos). A prior FAILURE leaves only an observation (no capability.invoked), so the
  // stage stays re-invocable via this same path (the manual route is the retry).
  const alreadyInvoked = await withActionContext(ctx, async (client) => {
    const r = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM event e
         JOIN event_kind_definition k ON k.id = e.event_kind_id
        WHERE e.tenant_id = $1 AND k.kind_name = 'capability.invoked'
          AND e.primary_entity_id = $2 AND e.payload ->> 'stage' = $3`,
      [ctx.tenantId, matterEntityId, stage.key],
    )
    return Number(r.rows[0]?.n ?? '0') > 0
  })
  if (alreadyInvoked) {
    return {
      ran: false,
      capabilitySlug: slug,
      handlerKey: '',
      gate: '',
      advanced: false,
      outputs: [],
      summary: `Capability for stage "${stage.key}" already ran on this matter — skipped (idempotent).`,
    }
  }

  // 2. Resolve the capability from the live registry (must be available + invocable).
  const registry = await listCapabilities(ctx)
  const capability = registry.find((c) => c.slug === slug) ?? null
  const serviceKey = await resolveServiceKey(ctx, matterEntityId)
  const handlerKey = capability?.spec.handler_key ?? ''

  const failInvoke = async (reason: string, tag: string): Promise<never> => {
    await recordObservation(agentCtx, matterEntityId, tag, { capability_slug: slug, reason })
    throw new CapabilityNotExecutableError(reason)
  }

  if (!capability) {
    await failInvoke(`No such capability "${slug}" in the registry.`, 'capability_not_executable')
  }
  const cap = capability as Capability
  if (cap.status !== 'available' || cap.spec.step_invocable !== true) {
    await failInvoke(
      `Capability "${slug}" is not runnable (status=${cap.status}, step_invocable=${cap.spec.step_invocable}).`,
      'capability_not_executable',
    )
  }
  if (!isHandlerImplemented(handlerKey)) {
    await failInvoke(
      `Capability "${slug}" is contracted but has no executable handler ("${handlerKey}") yet.`,
      'capability_not_executable',
    )
  }

  // 3. Run the real handler. A missing REQUIRED input records a failure observation
  //    and rethrows — no output, no advance (never a simulated success).
  const runDeps = deps ?? (await defaultDeps())
  let result: CapabilityHandlerResult
  try {
    result = await CAPABILITY_HANDLERS[handlerKey]!({
      agentCtx,
      matterEntityId,
      serviceKey,
      capabilitySlug: slug,
      config: (stepConfig.capability_config ?? {}) as Record<string, unknown>,
      deps: runDeps,
    })
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    await recordObservation(agentCtx, matterEntityId, 'capability_invoke_failed', {
      capability_slug: slug,
      handler_key: handlerKey,
      reason,
    })
    throw err
  }

  // 4. Audit the invocation (the receipt that the engine RAN the capability).
  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'capability.invoked',
      primary_entity_id: matterEntityId,
      data: {
        capability_slug: slug,
        handler_key: handlerKey,
        stage: stage.key,
        gate: cap.spec.default_gate ?? 'attorney',
        summary: result.summary,
        outputs: result.outputs,
      },
      source_type: 'agent',
      source_ref: CLAUDE_AGENT_ACTOR_ID,
    },
  })

  // 5. Apply the gate. attorney/client → park (the gate's own action advances the
  //    instance later). automatic/system → advance now via the audited path.
  const gate = cap.spec.default_gate ?? 'attorney'
  let advanced = false
  if (gate === 'automatic' || gate === 'system') {
    advanced = await advanceAutomaticFromStage(agentCtx, matterEntityId, stageInfo.currentState)
  }

  return {
    ran: true,
    capabilitySlug: slug,
    handlerKey,
    gate,
    advanced,
    outputs: result.outputs,
    summary: result.summary,
  }
}

// ── Real handler: AI document review (Contract A reuse) ──────────────────────────
// Reuses runDocumentReview verbatim — download → extract → central Anthropic adapter
// → review memo persisted through draft.generate (generation_mode 'ai_review') into
// the EXISTING review queue, with its own reasoning_trace. The rubric from the
// interview (stage config) is the base prompt; the invoke IS the enablement, so it
// bypasses the service-level review-enabled gate. Gate: attorney (memo → queue).
async function runAiDocumentReviewCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const rubric = String(
    (h.config.rubric as string | undefined) ?? (h.config.prompt as string | undefined) ?? '',
  ).trim()

  // The client's uploaded document (document_of the matter, newest first). Uploads
  // use document_of; generated drafts use draft_of — so this never picks a draft.
  const docs = await listMatterDocuments(h.agentCtx, h.matterEntityId)
  const doc = docs[0]
  if (!doc) {
    throw new CapabilityInputMissingError(
      'Cannot run AI document review — the client has not uploaded a document to this matter yet.',
    )
  }

  const result = await runDocumentReview(
    h.agentCtx,
    {
      matterEntityId: h.matterEntityId,
      documentEntityId: doc.documentEntityId,
      documentVersionId: doc.documentVersionId,
      serviceKey: h.serviceKey,
      originalFilename: doc.originalFilename,
      promptOverride: rubric || null,
    },
    { downloadObject: h.deps.downloadObject },
  )
  if (!result) {
    // runDocumentReview returns null on a non-retryable precondition failure and has
    // already recorded document.review.failed — surface it, do not simulate success.
    throw new CapabilityInputMissingError(
      `AI document review could not complete for "${doc.originalFilename}" (see document.review.failed).`,
    )
  }
  const effects = (result.effects[0] ?? {}) as { documentVersionId?: string }
  return {
    outputs: [
      {
        entityKind: 'document_draft',
        entityId: effects.documentVersionId,
        note: 'review_memo (pending_review in the attorney review queue)',
      },
    ],
    summary: `AI review memo produced for "${doc.originalFilename}".`,
  }
}

// ── Real handler: request client materials (Contract B reuse) ────────────────────
// Posts the firm's request to the matter's ONE portal thread (attorney.message.post
// — the existing client-messaging path). The stage's gate is `client`, so the matter
// PARKS here until the client's own delivery (an upload or a portal reply) advances
// it via dispatchClientDelivery. No new send path, thread, or portal surface.
async function runRequestClientMaterialsCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const message = String(
    (h.config.message as string | undefined) ?? (h.config.request as string | undefined) ?? '',
  ).trim()
  if (!message) {
    throw new CapabilityInputMissingError(
      'request_client_materials has no message configured (what to ask the client for).',
    )
  }
  const res = await submitAction(h.agentCtx, {
    actionKindName: 'attorney.message.post',
    intentKind: 'unknown',
    payload: { matter_entity_id: h.matterEntityId, body: message },
  })
  const effects = (res.effects[0] ?? {}) as { messageId?: string; threadId?: string }
  return {
    outputs: [
      {
        entityKind: 'communication_message',
        entityId: effects.messageId,
        note: 'client materials request posted to the portal thread',
      },
    ],
    summary: 'Requested materials from the client (portal message); parked at the client gate.',
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────────

async function resolveServiceKey(ctx: ActionContext, matterEntityId: string): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ service_key: string | null }>(
      `SELECT a.value #>> '{}' AS service_key
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
        WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'service_key'
        ORDER BY a.valid_from DESC LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows[0]?.service_key ?? ''
  })
}

async function recordObservation(
  agentCtx: ActionContext,
  matterEntityId: string,
  tag: string,
  data: Record<string, unknown>,
): Promise<void> {
  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: matterEntityId,
      data: { kind: tag, ...data },
      source_type: 'agent',
      source_ref: CLAUDE_AGENT_ACTOR_ID,
    },
  })
}

// Advance one automatic edge out of `fromState` via the audited legal.matter.advance
// path, as the agent (system) actor. Returns whether it advanced.
async function advanceAutomaticFromStage(
  agentCtx: ActionContext,
  matterEntityId: string,
  fromState: string,
): Promise<boolean> {
  const edge = await withActionContext(agentCtx, async (client) => {
    const instance = await getWorkflowInstanceForMatter(client, agentCtx.tenantId, matterEntityId)
    if (!instance) return null
    const bound = await resolveBoundWorkflowById(
      client,
      agentCtx.tenantId,
      instance.workflowDefinitionId,
    )
    const graph =
      instance.statesOverride && instance.statesOverride.length > 0
        ? instance.statesOverride
        : (bound?.graph ?? [])
    return allowedTransitions(graph, fromState, ['automatic'])[0] ?? null
  })
  if (!edge) return false
  await submitAction(agentCtx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'automatic_sync',
    payload: {
      matter_entity_id: matterEntityId,
      to_state: edge.to,
      gate: 'automatic',
      trigger: 'capability.invoked',
    },
  })
  return true
}
