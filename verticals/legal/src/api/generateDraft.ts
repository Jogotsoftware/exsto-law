import { randomUUID } from 'node:crypto'
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { enqueueJob } from '@exsto/worker-runtime'
import { callClaudeDrafter } from '../adapters/claude.js'
import {
  loadDraftingPrompt,
  loadEngagementLetterTemplate,
  loadOperatingAgreementTemplate,
} from '../templates/loader.js'
import { getMatter } from '../queries/matters.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent).
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface GenerateDraftInput {
  matterEntityId: string
  documentKind: 'operating_agreement' | 'engagement_letter'
}

// ───────────────────────────────────────────────────────────────────────────
// requestDraft — ASYNC ALWAYS (binding Lesson #2, REQ-PERF-02). Enqueues the
// drafting job and records draft.requested; the worker runs the model call.
// Auto-generation is single-member only in Phase 0 (REQ-DRAFT-05).
// ───────────────────────────────────────────────────────────────────────────

export async function requestDraft(
  ctx: ActionContext,
  input: GenerateDraftInput,
): Promise<{ jobId: string }> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)
  if (matter.workflowRoute !== 'auto') {
    throw new Error(
      `Matter ${matter.matterNumber} follows the manual workflow (${matter.serviceKey}); Phase 0 auto-drafting covers single-member formations only.`,
    )
  }

  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: 'legal.draft.run',
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: input.documentKind,
      requested_by: ctx.actorId,
    },
  })

  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'draft.requested',
      primary_entity_id: input.matterEntityId,
      data: { document_kind: input.documentKind, job_id: jobId },
      source_type: 'system',
    },
  })

  return { jobId }
}

// ───────────────────────────────────────────────────────────────────────────
// runDraftGeneration — the worker-side pipeline (REQ-DRAFT-01..04): assemble
// prompt from questionnaire + transcript + template under the NC rule binding,
// call Claude, persist the reasoning trace, submit draft.generate AS THE AGENT
// ACTOR. Non-retryable preconditions emit draft.failed and return; transient
// errors throw so the worker runtime retries with backoff.
// ───────────────────────────────────────────────────────────────────────────

export async function runDraftGeneration(
  ctx: ActionContext,
  input: GenerateDraftInput,
): Promise<ActionResult | null> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const matter = await getMatter(agentCtx, input.matterEntityId)

  const precondition = !matter
    ? `Matter not found: ${input.matterEntityId}`
    : !matter.questionnaireResponses
      ? `Matter ${input.matterEntityId} has no questionnaire response`
      : !matter.transcriptText
        ? `Matter ${input.matterEntityId} has no transcript yet`
        : null
  if (precondition) {
    await submitAction(agentCtx, {
      actionKindName: 'event.record',
      intentKind: 'automatic_sync',
      payload: {
        event_kind_name: 'draft.failed',
        primary_entity_id: input.matterEntityId,
        data: { document_kind: input.documentKind, reason: precondition, retryable: false },
        source_type: 'system',
      },
    })
    return null
  }

  const m = matter!
  const template =
    input.documentKind === 'engagement_letter'
      ? loadEngagementLetterTemplate()
      : loadOperatingAgreementTemplate()
  const prompt = assembleDraftingPrompt({
    template,
    questionnaireResponses: m.questionnaireResponses!,
    transcriptText: m.transcriptText!,
    documentKind: input.documentKind,
  })

  const result = await callClaudeDrafter({ prompt })

  const reasoningTraceId = await persistReasoningTrace(agentCtx, {
    prompt,
    evidence: result.reasoningTrace.evidence,
    alternatives: result.reasoningTrace.alternatives_considered,
    conclusion: result.reasoningTrace.conclusion,
    confidence: result.reasoningTrace.confidence,
    modelIdentity: result.modelIdentity,
    fullTrace: result.reasoningTrace,
  })

  return submitAction(agentCtx, {
    actionKindName: 'draft.generate',
    intentKind: 'enforcement',
    reasoningTraceId,
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: input.documentKind,
      document_markdown: result.documentMarkdown,
      model_identity: result.modelIdentity,
      reasoning_trace_id: reasoningTraceId,
      jurisdiction: 'NC',
      confidence: clampConfidence(result.reasoningTrace.confidence),
    },
  })
}

interface AssembleArgs {
  template: string
  questionnaireResponses: Record<string, unknown>
  transcriptText: string
  documentKind: 'operating_agreement' | 'engagement_letter'
}

function assembleDraftingPrompt(args: AssembleArgs): string {
  const basePrompt = loadDraftingPrompt()
  return basePrompt
    .replace(
      '{{questionnaire_responses_json}}',
      JSON.stringify(args.questionnaireResponses, null, 2),
    )
    .replace('{{transcript_text}}', args.transcriptText)
    .replace('{{operating_agreement_template}}', args.template)
    .replace(
      /operating agreement/gi,
      args.documentKind === 'engagement_letter' ? 'engagement letter' : 'operating agreement',
    )
}

interface PersistTraceArgs {
  prompt: string
  evidence: unknown[]
  alternatives: unknown[]
  conclusion: string
  confidence: number
  modelIdentity: string
  fullTrace: unknown
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistTraceArgs): Promise<string> {
  const id = randomUUID()
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        CLAUDE_AGENT_ACTOR_ID,
        args.prompt,
        JSON.stringify(args.evidence),
        JSON.stringify(args.alternatives),
        args.conclusion,
        clampConfidence(args.confidence),
        args.modelIdentity,
        JSON.stringify(args.fullTrace),
      ],
    )
  })
  return id
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
