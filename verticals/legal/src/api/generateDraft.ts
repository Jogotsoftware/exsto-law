import { randomUUID } from 'node:crypto'
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { enqueueJob } from '@exsto/worker-runtime'
import { callClaudeDrafter } from '../adapters/claude.js'
import { loadDraftingPrompt } from '../templates/loader.js'
import { getDraftingPrompt, getDocumentTemplate, resolveDocumentTemplateDoc } from './services.js'
import { getMatter } from '../queries/matters.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent).
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface GenerateDraftInput {
  matterEntityId: string
  // Any service-configured document kind. The two Phase-0 kinds
  // (operating_agreement, engagement_letter) ship a bundled body; novel kinds
  // (NDA, amendment, …) supply their body template through the Service Library.
  documentKind: string
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
  // Document-BODY selection is now config-as-data, per document kind (Doc-Types
  // PR1): an attorney-authored template in the service config wins; otherwise a
  // bundled repo body for the two Phase-0 kinds (the operating-agreement body is
  // service-aware — multi-member vs single-member). A novel kind with neither has
  // no document to draft — a non-retryable precondition. The completeness gate
  // normally blocks enabling such a service, so this is defense in depth. This
  // fills the {{operating_agreement_template}} slot below.
  const templateDoc = m.serviceKey
    ? await getDocumentTemplate(agentCtx, m.serviceKey, input.documentKind)
    : resolveDocumentTemplateDoc(undefined, '', input.documentKind)
  const template = templateDoc?.templateText ?? null
  if (!template) {
    await submitAction(agentCtx, {
      actionKindName: 'event.record',
      intentKind: 'automatic_sync',
      payload: {
        event_kind_name: 'draft.failed',
        primary_entity_id: input.matterEntityId,
        data: {
          document_kind: input.documentKind,
          reason: `No document template configured for "${input.documentKind}"`,
          retryable: false,
        },
        source_type: 'system',
      },
    })
    return null
  }
  const templateSource = templateDoc?.source ?? 'none'
  const templateVersion = templateDoc?.templateVersion ?? null

  // Resolve the drafting prompt from the matter's service config
  // (transitions.drafting.prompts[documentKind]) with a repo-file fallback. The
  // {{slot}} replacement below is unchanged — only the base prompt's source moves
  // from a fixed repo file to editable config.
  const resolved = m.serviceKey
    ? await getDraftingPrompt(agentCtx, m.serviceKey, input.documentKind)
    : null
  const basePrompt = resolved?.promptText ?? loadDraftingPrompt()
  const promptSource = resolved?.promptText ? resolved.source : 'repo'
  const promptVersion = resolved?.promptText ? resolved.promptVersion : null

  const prompt = assembleDraftingPrompt({
    basePrompt,
    template,
    questionnaireResponses: m.questionnaireResponses!,
    transcriptText: m.transcriptText!,
    documentKind: input.documentKind,
  })

  const result = await callClaudeDrafter(agentCtx.tenantId, { prompt })

  const reasoningTraceId = await persistReasoningTrace(agentCtx, {
    prompt,
    evidence: result.reasoningTrace.evidence,
    alternatives: result.reasoningTrace.alternatives_considered,
    conclusion: result.reasoningTrace.conclusion,
    confidence: result.reasoningTrace.confidence,
    modelIdentity: result.modelIdentity,
    fullTrace: result.reasoningTrace,
    // Record which prompt produced this draft so the audit trail names the config
    // version (or the repo fallback) the worker actually used.
    promptId:
      promptSource === 'config' && promptVersion != null
        ? `${m.serviceKey}/${input.documentKind}@config-v${promptVersion}`
        : `${input.documentKind}@repo`,
    // Name the BODY template the worker used too (config version vs bundled repo),
    // so the audit trail captures both inputs to the draft.
    templateId:
      templateSource === 'config' && templateVersion != null
        ? `${m.serviceKey}/${input.documentKind}@template-v${templateVersion}`
        : `${input.documentKind}@template-repo`,
  })

  const generated = await submitAction(agentCtx, {
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

  // Attorney email on async completion (WP6, REQ-NOTIFY-01).
  const { queueNotification } = await import('./notifications.js')
  const genEffects = (generated.effects[0] ?? {}) as { documentVersionId?: string }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? ''
  await queueNotification(agentCtx, {
    routeKindName: 'attorney_draft_completed',
    variables: {
      matter_entity_id: input.matterEntityId,
      matter_number: m.matterNumber,
      document_kind: input.documentKind,
      document_kind_label: input.documentKind.replace(/_/g, ' '),
      confidence: clampConfidence(result.reasoningTrace.confidence),
      review_url:
        baseUrl && genEffects.documentVersionId
          ? `${baseUrl}/attorney/review/${genEffects.documentVersionId}`
          : null,
    },
  })

  return generated
}

export interface AssembleArgs {
  basePrompt: string
  template: string
  questionnaireResponses: Record<string, unknown>
  transcriptText: string
  documentKind: string
}

// Fills the FIXED three-slot contract from the (config-or-repo) base prompt.
// Exported so tests can verify slot-filling for a service without a live Claude
// key (mirrors how draft-flow.test.ts exercises the no-live-key path).
export function assembleDraftingPrompt(args: AssembleArgs): string {
  // basePrompt is resolved by the caller (config-first, repo fallback). The slot
  // contract is FIXED: these are the same three slots the prompt editor validates.
  return args.basePrompt
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
  // Identifies WHICH drafting prompt and body template produced this draft (config
  // version vs repo fallback). reasoning_trace has no column for these, so we fold
  // them into the stored trace jsonb under prompt_config — no schema change, full
  // audit.
  promptId?: string
  templateId?: string
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistTraceArgs): Promise<string> {
  const id = randomUUID()
  const promptConfig =
    args.promptId || args.templateId
      ? { prompt_id: args.promptId ?? null, template_id: args.templateId ?? null }
      : null
  const traceWithPromptId =
    promptConfig && args.fullTrace && typeof args.fullTrace === 'object'
      ? {
          ...(args.fullTrace as Record<string, unknown>),
          prompt_config: promptConfig,
        }
      : args.fullTrace
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
        JSON.stringify(traceWithPromptId),
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
