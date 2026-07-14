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
import { renderTemplate, buildMergeData } from './templateMerge.js'
import { getTenantSettingsForMerge } from './tenantSettings.js'
import {
  loadForcedSkills,
  buildActiveSkillsText,
  resolveJurisdictionSkillSlugs,
} from './skillContext.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent).
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export type GenerationMode = 'ai_draft' | 'template_merge'

export interface GenerateDraftInput {
  matterEntityId: string
  // Any service-configured document kind. The two Phase-0 kinds
  // (operating_agreement, engagement_letter) ship a bundled body; novel kinds
  // (NDA, amendment, …) supply their body template through the Service Library.
  documentKind: string
  // Optional explicit override of the per-document generation mode. Normally the
  // worker resolves this from the service config (Contract G); a caller (the
  // "merge from template" UI action, or a receipt run) may force it.
  generationMode?: GenerationMode
  // Attorney's free-text instructions for THIS (re)draft — e.g. the revision notes
  // typed on the review screen. Appended to the drafting prompt so a regenerate
  // actually acts on what the attorney asked to change. AI path only.
  guidance?: string
  // Legal-skill slugs (claude-for-legal playbooks) to force-apply to this draft,
  // selected by the attorney. Their bodies are injected into the drafting prompt.
  skillSlugs?: string[]
  // CAPABILITY-UNIFY-1: an EXPLICIT template override. The document_generation
  // capability loads the firm template BY ENTITY ID (config_schema.template_entity_id)
  // and hands the body + a template id in here, so the producer draws its document
  // body from the exact template the step names — never resolving by (serviceKey,
  // docKind) convention. When set, it supersedes the config/repo template lookup for
  // both generation modes; everything downstream (persist, trace, notify) is identical.
  templateOverride?: { templateText: string; templateId: string }
  // BACKHALF-BLOCKS-1 (WP4) — regenerate SUPERSEDES: write the produced draft as
  // version n+1 on this existing document_draft entity (prior versions retained)
  // instead of a fresh entity at v1. Set by the regenerate runtime only.
  supersedesDocumentEntityId?: string
}

// ───────────────────────────────────────────────────────────────────────────
// requestDraft — ASYNC ALWAYS (binding Lesson #2, REQ-PERF-02). Enqueues the
// drafting job and records draft.requested; the worker runs the model call.
// Valid for ANY matter route: drafting is capability-routed (CAPABILITY-UNIFY-1),
// so the Phase 0 auto-only guard is gone (RUNNER-FIXES-1 WP5 — it predated the
// capability engine and 500'd regenerate on manual-route matters).
// ───────────────────────────────────────────────────────────────────────────

export async function requestDraft(
  ctx: ActionContext,
  input: GenerateDraftInput,
): Promise<{ jobId: string }> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)

  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: 'legal.draft.run',
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: input.documentKind,
      requested_by: ctx.actorId,
      guidance: input.guidance?.trim() || undefined,
      skill_slugs: input.skillSlugs?.length ? input.skillSlugs : undefined,
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

  // Drafting fires at QUESTIONNAIRE SUBMIT (beta sprint Obj 6) — the questionnaire
  // is the only hard precondition. A consultation transcript ENRICHES the draft
  // when present (post-call regeneration), but is NOT required: an initial draft is
  // produced from the intake answers alone, with no call dependency.
  const precondition = !matter
    ? `Matter not found: ${input.matterEntityId}`
    : !matter.questionnaireResponses
      ? `Matter ${input.matterEntityId} has no questionnaire response`
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
  // CAPABILITY-UNIFY-1: an explicit template override (the document_generation
  // capability, loading the template by entity id) wins over the config/repo lookup.
  // Otherwise resolve config-first with a bundled repo fallback (the bespoke path).
  const templateDoc = input.templateOverride
    ? {
        templateText: input.templateOverride.templateText,
        source: 'capability',
        templateVersion: null,
      }
    : m.serviceKey
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
  const templateId = input.templateOverride
    ? input.templateOverride.templateId
    : templateSource === 'config' && templateVersion != null
      ? `${m.serviceKey}/${input.documentKind}@template-v${templateVersion}`
      : `${input.documentKind}@template-repo`

  // ── Generation mode (WP3.4 / Objective 6) ────────────────────────────────
  // The default path is the AI draft (callClaudeDrafter). When the service config
  // (Contract G) marks this document as template_merge — or a caller forces it —
  // the worker renders the template DETERMINISTICALLY with matter + questionnaire
  // data: no Anthropic call, no reasoning trace. Same document_draft downstream.
  const generationMode =
    input.generationMode ??
    (await resolveGenerationMode(agentCtx, m.serviceKey, input.documentKind))

  if (generationMode === 'template_merge') {
    const service = await readServiceGeneration(agentCtx, m.serviceKey)
    // Firm identity fills {{firm_name}}/{{attorney_name}} — tokens the editors
    // have always offered. The ForMerge read degrades to unknown (honest
    // MISSING), never to the demo-firm defaults the Settings page shows.
    const settings = await getTenantSettingsForMerge(agentCtx)
    const { markdown, missingFields } = renderTemplate(
      template,
      buildMergeData(m, {
        effectiveDateIso: new Date().toISOString(),
        feeAmountFormatted: service.feeAmountFormatted,
        feeStructureHuman: service.feeStructureHuman,
        firmName: settings.firmName ?? undefined,
        attorneyName: settings.attorneyName ?? undefined,
        // P13 — the rest of the firm identity block (firm_profile singleton,
        // legacy-table fallback). Unknown stays undefined → honest MISSING;
        // the approve-time resolver is the safety net.
        firmEmail: settings.firmEmail ?? undefined,
        firmPhone: settings.firmPhone ?? undefined,
        firmAddress: settings.firmAddress ?? undefined,
      }),
    )

    const merged = await submitAction(agentCtx, {
      actionKindName: 'draft.merge',
      intentKind: 'automatic_sync',
      payload: {
        matter_entity_id: input.matterEntityId,
        document_kind: input.documentKind,
        document_markdown: markdown,
        jurisdiction: 'NC',
        template_id: templateId,
        missing_fields: missingFields,
        supersedes_document_entity_id: input.supersedesDocumentEntityId ?? null,
      },
    })

    // Same attorney "draft ready" email as the AI path (WP6, REQ-NOTIFY-01).
    const { queueNotification } = await import('./notifications.js')
    const mergeEffects = (merged.effects[0] ?? {}) as { documentVersionId?: string }
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? ''
    await queueNotification(agentCtx, {
      routeKindName: 'attorney_draft_completed',
      variables: {
        matter_entity_id: input.matterEntityId,
        matter_number: m.matterNumber,
        document_kind: input.documentKind,
        document_kind_label: input.documentKind.replace(/_/g, ' '),
        confidence: null,
        review_url:
          baseUrl && mergeEffects.documentVersionId
            ? `${baseUrl}/attorney/review/${mergeEffects.documentVersionId}`
            : null,
      },
    })

    return merged
  }

  // ── AI draft path (default) ──────────────────────────────────────────────
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

  // Skills applied to this draft = attorney-selected (force-applied) PLUS the right
  // jurisdiction playbook auto-resolved from the document kind, so a draft always gets
  // the correct legal skill even when the attorney picked none. Jurisdiction mirrors
  // the draft.generate binding below (NC). The resolver is conservative — it returns
  // nothing unless a skill strongly matches the document kind — so a first draft with
  // no good match behaves exactly as before. Attorney picks lead; auto picks are
  // appended and de-duped.
  const autoSkillSlugs = await resolveJurisdictionSkillSlugs(agentCtx, {
    documentKind: input.documentKind,
    jurisdiction: 'NC',
  })
  const skillSlugs = [...new Set([...(input.skillSlugs ?? []), ...autoSkillSlugs])]
  const forcedSkills = await loadForcedSkills(agentCtx, skillSlugs)
  const activeSkillsText = buildActiveSkillsText(forcedSkills)

  const prompt = assembleDraftingPrompt({
    basePrompt,
    template,
    questionnaireResponses: m.questionnaireResponses!,
    // Transcript is optional now (Obj 6): when the matter has no call yet, tell the
    // model to draft from the intake answers. A post-call run fills the real one.
    transcriptText:
      m.transcriptText ??
      '(No consultation transcript yet — draft from the intake questionnaire answers above.)',
    documentKind: input.documentKind,
    guidance: input.guidance,
    activeSkillsText,
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
    templateId,
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
      supersedes_document_entity_id: input.supersedesDocumentEntityId ?? null,
      // Token usage (snake_case, same shape recordAssistantTurn writes on
      // assistant.turn) so the AI usage & cost view counts drafting spend. Read
      // back by getAiUsageSummary; model is read from model_identity above.
      usage: {
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
      },
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
  // Selected-skill bodies (buildActiveSkillsText) injected so a picked playbook is
  // guaranteed to apply. Empty string when none selected.
  activeSkillsText?: string
  // Attorney's free-text instructions for this redraft (revision notes). Appended
  // LAST so the model treats it as the highest-priority guidance for this pass.
  guidance?: string
}

// Fills the FIXED three-slot contract from the (config-or-repo) base prompt.
// Exported so tests can verify slot-filling for a service without a live Claude
// key (mirrors how draft-flow.test.ts exercises the no-live-key path).
export function assembleDraftingPrompt(args: AssembleArgs): string {
  // basePrompt is resolved by the caller (config-first, repo fallback). The slot
  // contract is FIXED: these are the same three slots the prompt editor validates.
  let prompt = args.basePrompt
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

  // Selected legal playbooks (force-applied), then the attorney's own revision
  // instructions LAST — so they carry the most weight for this pass.
  if (args.activeSkillsText?.trim()) {
    prompt += `\n\n${args.activeSkillsText.trim()}`
  }
  if (args.guidance?.trim()) {
    prompt +=
      `\n\n--- Attorney instructions for this draft (apply these; they take precedence over the base prompt where they conflict) ---\n` +
      args.guidance.trim()
  }
  return prompt
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

// ───────────────────────────────────────────────────────────────────────────
// Service-config reads (Contract G — service/workflow config is owned by the
// templates/questionnaire session; the worker only READS it). Workers may read
// the DB directly (CLAUDE.md hard rule 9). generation_mode defaults to 'ai_draft'
// when the config does not set it, so the existing AI flow is never regressed.
// ───────────────────────────────────────────────────────────────────────────

interface ServiceGeneration {
  feeAmountFormatted?: string
  feeStructureHuman?: string
  // Per-document generation modes, when the config carries them.
  documentGeneration?: Record<string, { generation_mode?: string } | undefined>
}

async function loadServiceTransitions(
  ctx: ActionContext,
  serviceKey: string,
): Promise<Record<string, unknown> | null> {
  if (!serviceKey) return null
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ transitions: Record<string, unknown> }>(
      `SELECT transitions FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
       ORDER BY recorded_at DESC LIMIT 1`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0]?.transitions ?? null
  })
}

export async function resolveGenerationMode(
  ctx: ActionContext,
  serviceKey: string,
  documentKind: string,
): Promise<GenerationMode> {
  const transitions = await loadServiceTransitions(ctx, serviceKey)
  // Contract G may carry per-document config under `document_generation`
  // (preferred); otherwise honor the service-level `generation_mode` toggle the
  // Service editor writes. Either explicit choice — including 'template_merge'
  // (no AI) — takes effect; absent both, the default is the AI path.
  const docGen = (transitions?.document_generation ??
    null) as ServiceGeneration['documentGeneration']
  const serviceLevel = (transitions as { generation_mode?: string } | null)?.generation_mode
  const mode = docGen?.[documentKind]?.generation_mode ?? serviceLevel
  return mode === 'template_merge' ? 'template_merge' : 'ai_draft'
}

function readServiceGenerationFromTransitions(
  transitions: Record<string, unknown> | null,
): ServiceGeneration {
  const cost = (transitions?.cost ?? null) as {
    type?: string
    amount?: string
    hours?: number | null
  } | null
  if (!cost?.amount) return {}
  const amountNum = Number(cost.amount)
  const feeAmountFormatted = Number.isFinite(amountNum)
    ? amountNum.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    : `$${cost.amount}`
  const feeStructureHuman =
    cost.type === 'hourly'
      ? `an hourly rate of ${feeAmountFormatted}${cost.hours ? ` (estimated ${cost.hours} hours)` : ''}`
      : 'a fixed flat fee'
  return { feeAmountFormatted, feeStructureHuman }
}

async function readServiceGeneration(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceGeneration> {
  const transitions = await loadServiceTransitions(ctx, serviceKey)
  return readServiceGenerationFromTransitions(transitions)
}

// ───────────────────────────────────────────────────────────────────────────
// resolveStaleDraftJobs — operational hygiene (WP3.4). A drafting job that was
// claimed but never reached a terminal state (worker crash, deploy mid-run) can
// leave a matter stuck "generating" with no draft and no failure. This finds
// such jobs older than `staleMinutes` and emits draft.failed (retryable) so the
// matter surfaces the stall instead of hanging silently. Returns what it found.
// ───────────────────────────────────────────────────────────────────────────

export async function resolveStaleDraftJobs(
  ctx: ActionContext,
  staleMinutes = 30,
): Promise<{ matterEntityId: string; jobId: string; documentKind: string }[]> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const stale = await withActionContext(agentCtx, async (client) => {
    // A "stuck" draft job is one CLAIMED (status='running', locked_at set) whose
    // worker died before reaching a terminal state. Pending jobs are not stuck —
    // they are waiting/backing off and the queue will retry them. Dead-letter is
    // already terminal. So target running + stale lock only.
    const res = await client.query<{
      id: string
      payload: { matter_entity_id?: string; document_kind?: string }
    }>(
      `SELECT id, payload FROM worker_job
       WHERE tenant_id = $1
         AND job_kind = 'legal.draft.run'
         AND status = 'running'
         AND locked_at < now() - ($2 || ' minutes')::interval`,
      [agentCtx.tenantId, String(staleMinutes)],
    )
    return res.rows
  })

  const resolved: { matterEntityId: string; jobId: string; documentKind: string }[] = []
  for (const job of stale) {
    const matterEntityId = job.payload?.matter_entity_id
    const documentKind = job.payload?.document_kind ?? 'unknown'
    if (!matterEntityId) continue
    await submitAction(agentCtx, {
      actionKindName: 'event.record',
      intentKind: 'automatic_sync',
      payload: {
        event_kind_name: 'draft.failed',
        primary_entity_id: matterEntityId,
        data: {
          document_kind: documentKind,
          reason: `Drafting job ${job.id} stalled beyond ${staleMinutes}m without completing.`,
          retryable: true,
          job_id: job.id,
        },
        source_type: 'system',
      },
    })
    resolved.push({ matterEntityId, jobId: job.id, documentKind })
  }
  return resolved
}
