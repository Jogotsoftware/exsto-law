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
// Type-only (no runtime cycle): the document_generation handler dynamic-imports the
// producer; it only needs the GenerationMode union at compile time.
import type { GenerationMode } from './generateDraft.js'

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
  'legal.capability.document_generation.run': runDocumentGenerationCapability,
  'legal.capability.ai_document_review.run': runAiDocumentReviewCapability,
  'legal.capability.request_client_materials.run': runRequestClientMaterialsCapability,
  'legal.capability.esignature.run': runEsignatureCapability,
  'legal.capability.email_generation.run': runEmailGenerationCapability,
  'legal.capability.transcript_extraction.run': runTranscriptExtractionCapability,
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

// CAPABILITY-UNIFY-1 (WP3) — the worker-job kind that runs ANY invoke_capability step
// OFF the request. The job kind is a text value, needs no migration.
export const CAPABILITY_RUN_JOB_KIND = 'legal.capability.run'

// Enqueue the capability run for a matter parked on an invoke_capability stage (WP3).
// This is the ONE fast INSERT the producing auto-run's post-commit callback does, and
// the same job the manual /workflow/invoke route enqueues — a uniform, off-request
// path (mirrors PROD-DRAFT-OFFLOAD-1's enqueueDraftAutoRunJob for drafting). It runs
// in-request (post-commit) or in the route, so it NEVER calls the model or a handler;
// it only writes the job row (+ a queryable observation) and returns. The worker
// claims the job and runs invokeCapabilityForMatter, whose own idempotency + gate
// logic are unchanged — they just run on the worker now, past the serverless boundary
// that killed the deferred in-request execution. `stageKey` is recorded for the
// timeline; the worker re-resolves the matter's current stage when it runs, so a
// stale stage key never mis-dispatches.
export async function enqueueCapabilityRunJob(
  base: { tenantId: string; actorId: string },
  matterEntityId: string,
  stageKey: string,
): Promise<string | null> {
  const { enqueueJob } = await import('@exsto/worker-runtime')
  const agentCtx: ActionContext = { tenantId: base.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  let jobId: string
  try {
    jobId = await enqueueJob({
      tenantId: base.tenantId,
      jobKind: CAPABILITY_RUN_JOB_KIND,
      payload: { matter_entity_id: matterEntityId, stage_key: stageKey },
    })
  } catch (err) {
    // A failed enqueue records a queryable observation and rethrows; the matter stays
    // parked + re-invocable (the manual route is the retry) — never a silent death.
    await recordObservation(agentCtx, matterEntityId, 'capability_run_enqueue_failed', {
      stage: stageKey,
      reason: err instanceof Error ? err.message : String(err),
      retryable: true,
    })
    throw err
  }
  await recordObservation(agentCtx, matterEntityId, 'capability_run_enqueued', {
    stage: stageKey,
    job_id: jobId,
  })
  return jobId
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

// ── Real handler: document generation (CAPABILITY-UNIFY-1 — the first fully-migrated
// LEGO block) ─────────────────────────────────────────────────────────────────────
// ONE capability, reused across services, drafting a DIFFERENT document per step. It
// REUSES the proven producer (generateDraft.runDraftGeneration — the exact path the
// attorney manual draft and the legal.draft.run worker use); it is NOT a second
// drafting implementation. The ONLY differences from the bespoke generate_document
// path: (1) the template is loaded BY template_entity_id from capability_config —
// never by (serviceKey, docKind) convention, no docKind fallback lookup; (2) the
// generation mode + drafting instructions come from the step's config, not the
// service. Persist/trace/attribution/notify are identical. Gate is `automatic` (from
// the registry): after the draft, invokeCapabilityForMatter advances the automatic
// edge to the human-gated review stage, which WAITS — same net behavior as today.
async function runDocumentGenerationCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const templateEntityId = String((h.config.template_entity_id as string | undefined) ?? '').trim()
  if (!templateEntityId) {
    // No convention fallback, no silent docKind lookup — a missing id is a hard,
    // visible failure (the runtime records the failure observation on the rethrow).
    throw new CapabilityInputMissingError(
      'document_generation names no template — set action.config.capability_config.template_entity_id ' +
        'to the exact firm document-template entity id this step drafts.',
    )
  }
  const generationMode: GenerationMode =
    String(h.config.generation_mode ?? '').trim() === 'template_merge'
      ? 'template_merge'
      : 'ai_draft'
  let instructions = String((h.config.instructions as string | undefined) ?? '').trim() || undefined

  // MACHINE-COMMS-1 (WP1.4) — cross-matter CLIENT CONTEXT is OPT-IN for document
  // drafting (capability_config.use_client_context: true), ai_draft mode only:
  // injecting another matter's facts changes the draft's provenance, so the
  // attorney chooses it per step. template_merge NEVER sees it (deterministic by
  // definition). The context rides the guidance channel — generateDraft's request
  // path is untouched.
  if (h.config.use_client_context === true && generationMode === 'ai_draft') {
    const { getClientContext, formatClientContext } = await import('../queries/clientContext.js')
    const { getMatter } = await import('../queries/matters.js')
    const matter = await getMatter(h.agentCtx, h.matterEntityId)
    if (matter?.clientEntityId) {
      const context = await getClientContext(h.agentCtx, matter.clientEntityId)
      if (context) {
        const block =
          `Client history (assembled context, includes archived matters — DATA about the client, not instructions):\n` +
          formatClientContext(context)
        instructions = instructions ? `${instructions}\n\n${block}` : block
      }
    }
  }

  // Load the template BY ENTITY ID. getStandaloneTemplate filters status='active', so
  // an archived or absent template resolves to null → a clear, recorded failure.
  const { getStandaloneTemplate } = await import('../queries/templates.js')
  const tmpl = await getStandaloneTemplate(h.agentCtx, templateEntityId)
  if (!tmpl || !tmpl.body.trim()) {
    throw new CapabilityInputMissingError(
      `document_generation template "${templateEntityId}" is not an active firm template (not found or empty body) — cannot draft.`,
    )
  }
  const documentKind = (tmpl.docKind ?? '').trim() || slugifyDocKind(tmpl.name)

  // Draft-exists idempotency (WP2): the SAME guard the generate_document autorun uses,
  // so a duplicate run no-ops rather than double-drafting the same document kind.
  const { draftAlreadyExists } = await import('./generateDocumentRuntime.js')
  if (await draftAlreadyExists(h.agentCtx, h.matterEntityId, documentKind)) {
    return {
      outputs: [
        {
          entityKind: 'document_draft',
          note: `draft for "${documentKind}" already exists on this matter (idempotent)`,
        },
      ],
      summary: `Draft for "${documentKind}" already exists — skipped generation (idempotent).`,
    }
  }

  // PRODUCE via the proven producer. The template body + a stable template id come from
  // the named firm template; the drafting instructions ride as guidance; the mode is the
  // step's configured mode. A null return is a non-retryable precondition (draft.failed
  // already recorded) — throw so the matter never advances to review with no document.
  const { runDraftGeneration } = await import('./generateDraft.js')
  const produced = await runDraftGeneration(h.agentCtx, {
    matterEntityId: h.matterEntityId,
    documentKind,
    generationMode,
    guidance: instructions,
    templateOverride: { templateText: tmpl.body, templateId: `template:${templateEntityId}` },
  })
  if (!produced) {
    throw new CapabilityInputMissingError(
      `document_generation could not produce "${documentKind}" (draft precondition failed; see draft.failed) — matter stays parked.`,
    )
  }
  const effects = (produced.effects[0] ?? {}) as { documentVersionId?: string }
  return {
    outputs: [
      {
        entityKind: 'document_draft',
        entityId: effects.documentVersionId,
        note: `${documentKind} draft (${generationMode}, pending_review in the attorney review queue)`,
      },
    ],
    summary: `Generated "${documentKind}" (${generationMode}) — pending attorney review.`,
  }
}

// A document kind derived from a template name when the template carries no explicit
// docKind (a firm template SHOULD have one; this keeps the draft-exists guard and the
// draft's document_kind stable rather than failing on a config gap). Exported for the
// WP4 regenerate runtime, which must derive the SAME kind the original run did.
export function slugifyDocKind(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'document'
  )
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

// ── Real handler: e-signature (ESIGN-BLOCK-1 WP2 — Session-5 native engine reuse) ──
// Sends the matter's signable document for signature through the EXISTING
// provider-agnostic e-sign path (api/esign.sendForSignature) — the same envelope,
// signature_request, sign-by-link/portal delivery, and esign.* action kinds the
// attorney's manual "Send for signature" uses. NOT a second adapter, NOT a second
// webhook: envelope completion already fires esign.completed (handlers/esign.ts)
// and dispatchLifecycleEvent already advances any matter whose stage waits ON
// 'esign.completed' — so this handler only SENDS and PARKS. The stage's gate is
// `system` (from the registry): invokeCapabilityForMatter finds no automatic edge,
// the matter waits, and the signature completion is what advances it.
//
// The signable document = the latest APPROVED document version on the matter —
// nothing unapproved ever goes out for signature (the review queue is the human
// gate). Optional capability_config.document_kind pins WHICH document when a
// matter produces several. No approved document → a recorded, honest park
// (CapabilityInputMissingError), never a fake envelope.
//
// No-simulate: sendForSignature itself fails hard when the native engine cannot
// dispatch (e.g. ESIGN_SIGNING_SECRET/OAUTH_STATE_SECRET absent → link tokens
// cannot be signed; no client email on the matter). The runtime's catch records
// capability_invoke_failed and the matter stays parked + re-invocable.
async function runEsignatureCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const wantedKind = String((h.config.document_kind as string | undefined) ?? '').trim()

  const { listMatterDraftVersions } = await import('../queries/drafts.js')
  const versions = await listMatterDraftVersions(h.agentCtx, h.matterEntityId)
  const approved = versions
    .filter((v) => v.status === 'approved')
    .filter((v) => !wantedKind || v.documentKind === wantedKind)
    .sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : -1))
  const doc = approved[0]
  if (!doc) {
    throw new CapabilityInputMissingError(
      wantedKind
        ? `Cannot send for signature — no APPROVED "${wantedKind}" document version on this matter yet (approve it in the review queue first).`
        : 'Cannot send for signature — the matter has no approved document version yet (approve the draft in the review queue first).',
    )
  }

  // Send through the ONE existing e-sign path (native provider by default). Signers
  // default to the matter's client contact — the signer_roles declaration on the
  // template steers composition (WP3); delivery beyond the client (witness/notary)
  // is the attorney's prepare-UI call, not something this step invents.
  const { sendForSignature } = await import('./esign.js')
  const sent = await sendForSignature(h.agentCtx, { documentVersionId: doc.documentVersionId })
  if (!sent.dispatched) {
    // An undispatched envelope (external provider not connected) is a recorded
    // pending_dispatch, not a sent signature request — surface it as the honest
    // failure so the matter parks visibly instead of pretending it went out.
    throw new CapabilityInputMissingError(
      `E-sign envelope ${sent.envelopeId} was recorded but NOT dispatched (${sent.activation ?? 'provider not connected'}) — the matter stays parked until the provider is configured and the step is re-run.`,
    )
  }

  return {
    outputs: [
      {
        entityKind: 'signature_envelope',
        entityId: sent.envelopeId,
        note: `"${doc.documentKind}" v${doc.versionNumber} sent for signature (${sent.provider}, ${sent.signerCount} signer${sent.signerCount === 1 ? '' : 's'})`,
      },
    ],
    summary: `Sent "${doc.documentKind}" for signature — matter waits at the system gate for esign.completed.`,
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

// ── Real handler: email generation (MACHINE-COMMS-1 WP2 — the machine's voice) ────
// Composes an outbound email draft — ai_draft (matter facts + assembled client
// history + attorney instructions + firm skills) or deterministic template merge —
// and persists it on the COMMUNICATION channel: a communication_draft whose version
// lands pending_review in the attorney review queue. Gate `attorney` (from the
// registry): the matter PARKS until the attorney approves — and approving IS the
// send (api/reviewDraft → Contract B mail.send). Nothing reaches a client
// unapproved. Config: purpose (required for ai_draft), recipient_role, mode,
// template_entity_id (template mode).
async function runEmailGenerationCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const { composeEmailDraft } = await import('./generateEmail.js')
  const mode = String(h.config.mode ?? '').trim() === 'template' ? 'template' : 'ai_draft'
  const composed = await composeEmailDraft(h.agentCtx, {
    matterEntityId: h.matterEntityId,
    purpose: String((h.config.purpose as string | undefined) ?? '').trim() || undefined,
    recipientRole: String(h.config.recipient_role ?? '').trim() === 'other' ? 'other' : 'client',
    mode,
    templateEntityId:
      String((h.config.template_entity_id as string | undefined) ?? '').trim() || undefined,
    // Ad-hoc regenerate (WP2.3): version n+1 on the existing draft entity, with the
    // attorney's revision notes as guidance. Composed stages never set these.
    supersedesDocumentEntityId:
      String((h.config.supersedes_document_entity_id as string | undefined) ?? '').trim() ||
      undefined,
    guidance: String((h.config.guidance as string | undefined) ?? '').trim() || undefined,
  })
  return {
    outputs: [
      {
        entityKind: 'communication_draft',
        entityId: composed.documentVersionId ?? undefined,
        note: `email draft "${composed.subject}" (${composed.mode}, pending_review — approve to send)`,
      },
    ],
    summary: `Email draft "${composed.subject}" is in the review queue — approving it sends it.`,
  }
}

// ── Real handler: transcript extraction (MACHINE-COMMS-1 WP3 — memory intake) ─────
// Distills the matter's transcript into notes (summary + facts/action items) that
// feed getClientContext. Gate `attorney`: the extraction lands for review like
// everything else — extracted "facts" are AI output. Config: transcript_entity_id
// (optional; defaults to the matter's latest transcript), instructions (optional).
async function runTranscriptExtractionCapability(
  h: CapabilityHandlerContext,
): Promise<CapabilityHandlerResult> {
  const { runTranscriptExtraction } = await import('./transcriptExtraction.js')
  let extraction
  try {
    extraction = await runTranscriptExtraction(h.agentCtx, {
      matterEntityId: h.matterEntityId,
      transcriptEntityId:
        String((h.config.transcript_entity_id as string | undefined) ?? '').trim() || undefined,
      instructions: String((h.config.instructions as string | undefined) ?? '').trim() || undefined,
    })
  } catch (err) {
    // "No transcript yet" is a missing REQUIRED input — park honestly, re-invocable.
    if (err instanceof Error && /No transcript/i.test(err.message)) {
      throw new CapabilityInputMissingError(err.message)
    }
    throw err
  }
  return {
    outputs: [
      { entityKind: 'note', entityId: extraction.summaryNoteId, note: 'consultation summary note' },
      ...extraction.extractedNoteIds.map((id) => ({
        entityKind: 'note',
        entityId: id,
        note: 'extracted fact / action item',
      })),
    ],
    summary:
      `Extracted ${extraction.factCount} fact(s) + ${extraction.actionItemCount} action item(s) ` +
      `and a summary from the transcript — notes on the matter, pending attorney review.`,
  }
}

// ── Ad-hoc capability runs (MACHINE-COMMS-1 WP2.3/WP3.3) ──────────────────────────
// The SAME capability handlers, runnable on any matter WITHOUT a workflow stage —
// "draft an email to the client about X" / "extract this transcript" from the
// matter page or the assistant. One generic path (no per-capability job kinds):
// enqueue → worker → runAdHocCapability → the registered handler. Deliberately NO
// (matter, stage) idempotency guard: repeated ad-hoc runs are legitimate (two
// different emails on one matter). The gate is NOT applied (there is no stage to
// park/advance) — for these capabilities the review queue IS the gate.
export const CAPABILITY_ADHOC_JOB_KIND = 'legal.capability.adhoc'

export async function enqueueAdHocCapabilityJob(
  ctx: ActionContext,
  input: { capabilitySlug: string; matterEntityId: string; config?: Record<string, unknown> },
): Promise<string> {
  const { enqueueJob } = await import('@exsto/worker-runtime')
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: CAPABILITY_ADHOC_JOB_KIND,
    payload: {
      capability_slug: input.capabilitySlug,
      matter_entity_id: input.matterEntityId,
      config: input.config ?? {},
      requested_by: ctx.actorId,
    },
  })
  await recordObservation(agentCtx, input.matterEntityId, 'capability_adhoc_enqueued', {
    capability_slug: input.capabilitySlug,
    job_id: jobId,
  })
  return jobId
}

export async function runAdHocCapability(
  ctx: ActionContext,
  input: { capabilitySlug: string; matterEntityId: string; config?: Record<string, unknown> },
  deps?: CapabilityRuntimeDeps,
): Promise<InvokeCapabilityResult> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const slug = input.capabilitySlug.trim()

  const registry = await listCapabilities(ctx)
  const capability = registry.find((c) => c.slug === slug) ?? null
  const failInvoke = async (reason: string): Promise<never> => {
    await recordObservation(agentCtx, input.matterEntityId, 'capability_not_executable', {
      capability_slug: slug,
      reason,
      ad_hoc: true,
    })
    throw new CapabilityNotExecutableError(reason)
  }
  if (!capability) await failInvoke(`No such capability "${slug}" in the registry.`)
  const cap = capability as Capability
  const handlerKey = cap.spec.handler_key ?? ''
  if (cap.status !== 'available' || cap.spec.step_invocable !== true) {
    await failInvoke(
      `Capability "${slug}" is not runnable (status=${cap.status}, step_invocable=${cap.spec.step_invocable}).`,
    )
  }
  if (!isHandlerImplemented(handlerKey)) {
    await failInvoke(`Capability "${slug}" is contracted but has no executable handler yet.`)
  }

  const serviceKey = await resolveServiceKey(ctx, input.matterEntityId)
  const runDeps = deps ?? (await defaultDeps())
  let result: CapabilityHandlerResult
  try {
    result = await CAPABILITY_HANDLERS[handlerKey]!({
      agentCtx,
      matterEntityId: input.matterEntityId,
      serviceKey,
      capabilitySlug: slug,
      config: input.config ?? {},
      deps: runDeps,
    })
  } catch (err) {
    await recordObservation(agentCtx, input.matterEntityId, 'capability_invoke_failed', {
      capability_slug: slug,
      handler_key: handlerKey,
      reason: err instanceof Error ? err.message : String(err),
      ad_hoc: true,
    })
    throw err
  }

  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'capability.invoked',
      primary_entity_id: input.matterEntityId,
      data: {
        capability_slug: slug,
        handler_key: handlerKey,
        stage: 'ad_hoc',
        gate: 'attorney',
        summary: result.summary,
        outputs: result.outputs,
      },
      source_type: 'agent',
      source_ref: CLAUDE_AGENT_ACTOR_ID,
    },
  })

  return {
    ran: true,
    capabilitySlug: slug,
    handlerKey,
    gate: 'attorney',
    advanced: false,
    outputs: result.outputs,
    summary: result.summary,
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
// path, as the agent (system) actor. Returns whether it advanced. `trigger` names the
// signal that made the edge fire (defaults to the capability case; the generate_document
// producing-autorun passes 'draft.completed'); it is recorded on the advance for audit.
// Exported so the sibling producing-autorun runtimes (generateDocumentRuntime) reuse the
// SAME audited advance rather than re-implementing it — the invoke_capability path is
// unchanged (the added param is defaulted).
export async function advanceAutomaticFromStage(
  agentCtx: ActionContext,
  matterEntityId: string,
  fromState: string,
  trigger = 'capability.invoked',
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
  // legal.matter.advance rejects an `automatic` gate fired by a human actor. The module
  // const above is TENANT-ZERO's agent actor; a different tenant (the sandbox, a second
  // firm) has its OWN agent/system actor id, so the hardcoded id resolves to no row →
  // treated as human → the advance is rejected. Resolve THIS tenant's agent/system actor
  // so automatic advances work in every tenant (no-op in tenant-zero, where it resolves
  // to the same id). This is why #303's automatic-gate branch — never exercised by an
  // attorney/client-gated capability — was silently broken outside tenant-zero.
  const systemActorId = await resolveTenantSystemActorId(agentCtx)
  const sysCtx: ActionContext = { tenantId: agentCtx.tenantId, actorId: systemActorId }
  await submitAction(sysCtx, {
    actionKindName: 'legal.matter.advance',
    intentKind: 'automatic_sync',
    payload: {
      matter_entity_id: matterEntityId,
      to_state: edge.to,
      gate: 'automatic',
      trigger,
    },
  })
  return true
}

// The tenant's own system/agent actor id (an `automatic`/`system` advance must come from
// a non-human actor). Prefers the tenant's `agent` actor (Claude), then any `system`
// actor; falls back to the tenant-zero agent const if the tenant seeds neither (so
// tenant-zero behavior is unchanged even if the lookup is ever empty).
export async function resolveTenantSystemActorId(ctx: ActionContext): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ id: string }>(
      `SELECT id FROM actor
        WHERE tenant_id = $1 AND actor_type IN ('agent', 'system')
        ORDER BY CASE actor_type WHEN 'agent' THEN 0 ELSE 1 END, id
        LIMIT 1`,
      [ctx.tenantId],
    )
    return r.rows[0]?.id ?? CLAUDE_AGENT_ACTOR_ID
  })
}
