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
import { DOCUMENT_STYLE_INSTRUCTION } from '../templates/documentStyle.js'
import { getDraftingPrompt, getDocumentTemplate, resolveDocumentTemplateDoc } from './services.js'
import { getMatter } from '../queries/matters.js'
import { renderTemplate, buildMergeData, longDate } from './templateMerge.js'
import { canonicalizeExecutionLines } from '../esign/executionBlock.js'
import { getTenantSettingsForMerge } from './tenantSettings.js'
import { resolveMatterJurisdiction, type ResolvedJurisdiction } from './matterJurisdiction.js'
import { findUnresolvedTokens } from './tokenClasses.js'
import { FORMATTING_DIRECTIVES } from './formattingDirectives.js'
import {
  loadForcedSkills,
  buildActiveSkillsText,
  resolveJurisdictionSkillSlugs,
} from './skillContext.js'
import {
  assembleBriefEvidence,
  renderEvidenceBundle,
  type EvidenceBundle,
} from './briefEvidence.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent).
import { resolveTenantAgentCtx } from './tenantActors.js'

export type GenerationMode = 'ai_draft' | 'template_merge'

// ── Service Digest injection (WP B1 — "generation gets smarter from accepted
// edits") ─────────────────────────────────────────────────────────────────
// The Brief Engine's service_digest scope (briefEvidence.ts) already assembles
// accepted AI-revision instructions, manual edit notes, and revision requests
// across every matter currently on a service — a standing record of how
// attorneys have shaped this service's drafts. This wires that evidence INTO
// drafting itself, so a new draft on the same service starts closer to what the
// attorney actually wants, without the attorney re-typing the same instruction
// every time. AI path only — template_merge is deterministic by contract and
// must never see AI-sourced context.
const SERVICE_DIGEST_MAX_CHARS = 2500

const SERVICE_DIGEST_FRAMING_HEADER =
  'Standing drafting preferences for this service, learned from edits attorneys have previously ' +
  'accepted on drafts of it (accepted AI revisions, manual edits, and revision requests across ' +
  "matters on this service). Treat these as defaults worth carrying forward. The attorney's " +
  'instructions for THIS draft, given below if any, take precedence over these standing ' +
  'preferences wherever they conflict.'

// PURE — decides whether a draft should even attempt the digest read. Checked
// defensively at the generationMode level too (not just by the caller only
// reaching this in the AI-draft branch): template_merge must NEVER receive AI
// context, and this stays true even if a future refactor moves the call site.
export function shouldAssembleServiceDigest(
  generationMode: GenerationMode,
  serviceKey: string | null | undefined,
  useServiceDigest: boolean | undefined,
): boolean {
  return generationMode === 'ai_draft' && !!serviceKey && useServiceDigest !== false
}

export interface ServiceDigestTraceMeta {
  watermark: string
  sections: number
  chars: number
}

// PURE — turns an already-assembled digest EvidenceBundle into prompt text +
// its trace metadata, or null when the service genuinely has no signals yet (an
// empty bundle is a valid, common state — not a failure). Budget-capped so a
// service with a long drafting history never balloons the drafting prompt.
export function renderServiceDigestForDraft(
  bundle: EvidenceBundle,
): { text: string; meta: ServiceDigestTraceMeta } | null {
  if (bundle.sections.length === 0) return null
  const text = renderEvidenceBundle(bundle, {
    header: SERVICE_DIGEST_FRAMING_HEADER,
    maxChars: SERVICE_DIGEST_MAX_CHARS,
  })
  return {
    text,
    meta: {
      watermark: bundle.sourceWatermark,
      sections: bundle.sections.length,
      chars: text.length,
    },
  }
}

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
  // WP B1 — opt OUT of the service digest injection (standing drafting
  // preferences learned from previously accepted edits on this service).
  // Defaults to true; AI path only, no-ops on template_merge regardless.
  useServiceDigest?: boolean
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
  const agentCtx = await resolveTenantAgentCtx(ctx)
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
  // WP A2 — the matter's own resolved jurisdiction (matter fact, else the
  // firm's home jurisdiction, else honest unset). NEVER a hardcoded 'NC'.
  const jurisdiction = await resolveMatterJurisdiction(agentCtx, input.matterEntityId)
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
    // WP A2b — the matter's own governing-law fact (client intake answer, with
    // the firm's home jurisdiction as fallback), never a hardcoded state.
    const jurisdiction = await resolveMatterJurisdiction(agentCtx, input.matterEntityId)
    const { markdown, missingFields } = renderTemplate(
      template,
      buildMergeData(m, {
        effectiveDateIso: new Date().toISOString(),
        feeAmountFormatted: service.feeAmountFormatted,
        feeStructureHuman: service.feeStructureHuman,
        firmName: settings.firmName ?? undefined,
        attorneyName: settings.attorneyName ?? undefined,
        governingJurisdiction: jurisdiction?.displayName,
        // P13 — the rest of the firm identity block (firm_profile singleton,
        // legacy-table fallback). Unknown stays undefined → honest MISSING;
        // the approve-time resolver is the safety net.
        firmEmail: settings.firmEmail ?? undefined,
        firmPhone: settings.firmPhone ?? undefined,
        firmAddress: settings.firmAddress ?? undefined,
      }),
    )

    // EDITOR-FIX-1 (item 6a): a legacy template body may end with a compound
    // execution line (a printed name/role + an inline `Date: ____` rule). Split
    // it so the trailing rule becomes a whole-line ruled signature/date line
    // everywhere it renders — never literal broken underscores.
    const canonicalMarkdown = canonicalizeExecutionLines(markdown)

    const merged = await submitAction(agentCtx, {
      actionKindName: 'draft.merge',
      intentKind: 'automatic_sync',
      payload: {
        matter_entity_id: input.matterEntityId,
        document_kind: input.documentKind,
        document_markdown: canonicalMarkdown,
        jurisdiction: jurisdiction?.code ?? null,
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
  // the draft.generate binding below (the matter's own resolved jurisdiction, never a
  // hardcoded 'NC'). The resolver is conservative — it returns nothing unless a skill
  // strongly matches the document kind — so an unset jurisdiction or a first draft
  // with no good match behaves exactly as before. Attorney picks lead; auto picks are
  // appended and de-duped.
  const autoSkillSlugs = await resolveJurisdictionSkillSlugs(agentCtx, {
    documentKind: input.documentKind,
    jurisdiction: jurisdiction?.code,
  })
  const skillSlugs = [...new Set([...(input.skillSlugs ?? []), ...autoSkillSlugs])]
  const forcedSkills = await loadForcedSkills(agentCtx, skillSlugs)
  const activeSkillsText = buildActiveSkillsText(forcedSkills)

  // WP B1 — Service Digest injection. Graceful-degrade: this reads a
  // cross-matter signal (briefEvidence.ts's service_digest scope) that is
  // genuinely optional to a draft — a failure to assemble or render it must
  // never block drafting, so any error here is logged and swallowed.
  let serviceDigestText: string | undefined
  let serviceDigestTrace: ServiceDigestTraceMeta | null = null
  if (shouldAssembleServiceDigest('ai_draft', m.serviceKey, input.useServiceDigest)) {
    try {
      const digestBundle = await assembleBriefEvidence(
        agentCtx,
        { kind: 'service_digest', serviceKey: m.serviceKey },
        'lean',
      )
      const rendered = renderServiceDigestForDraft(digestBundle)
      if (rendered) {
        serviceDigestText = rendered.text
        serviceDigestTrace = rendered.meta
      }
    } catch (err) {
      console.error(
        `[generateDraft] service digest assembly failed for service "${m.serviceKey}" — proceeding without it.`,
        err,
      )
    }
  }

  // Generation-integrity fix — the SAME resolved jurisdiction from the top of
  // this function (never re-resolved), today's date, and the firm's name
  // (anti-forgery read — never the demo-firm default), stated as facts the
  // model must ground the document in. Mirrors the template_merge branch
  // above, which has always stamped these onto a merged document.
  const firmForFacts = await getTenantSettingsForMerge(agentCtx)
  const systemFactsText = buildSystemFactsBlock({
    jurisdiction,
    todayIso: new Date().toISOString(),
    firmName: firmForFacts.firmName,
  })

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
    systemFactsText,
    // Document-formatting standard — every AI draft is held to the same
    // polished, professional legal-document typography and structure.
    styleText: DOCUMENT_STYLE_INSTRUCTION,
    activeSkillsText,
    serviceDigestText,
  })

  const result = await callClaudeDrafter(agentCtx.tenantId, { prompt, task: 'draft_generate' })

  // Generation-integrity fix — the platform's own honesty net: every raw
  // {{token}} the model left behind, recorded regardless of what its own
  // `ambiguities` list says (see PersistTraceArgs.unresolvedTokens).
  const unresolvedTokens = findUnresolvedTokens(result.documentMarkdown)

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
    // Whether/how the Service Digest fired (WP B1) — null when not injected
    // (opted out, no serviceKey, no signals yet, or a swallowed failure). The
    // prompt column above already carries the injected text verbatim; this is
    // the structured record of what happened, for the review-UI trace panel.
    serviceDigest: serviceDigestTrace,
    unresolvedTokens,
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
      jurisdiction: jurisdiction?.code ?? null,
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

// ── System facts injection (generation integrity) ───────────────────────────
// The three-slot AI prompt contract (questionnaire, transcript, template) never
// carried the matter's resolved jurisdiction or today's date, even though
// runDraftGeneration already resolves the jurisdiction (for skills/audit) and
// the deterministic template_merge path (buildMergeData) has always stamped
// both onto a merged document. This is the AI path's equivalent: the SAME
// resolved jurisdiction — never re-resolved here — plus today's date and the
// firm's name, stated as facts the model must ground the document in rather
// than guess. An unset jurisdiction is stated explicitly (never silently
// omitted), matching buildMergeData's honest-[[MISSING]] posture: this is what
// stops a model from picking a state on its own, which is how a North Carolina
// governing-law clause once shipped for a Georgia client with no jurisdiction
// fact ever in its context.
export interface SystemFacts {
  jurisdiction: ResolvedJurisdiction | null
  todayIso: string
  // Anti-forgery: pass the getTenantSettingsForMerge read (honest-unset), never
  // getTenantSettings's demo-firm-default fallback.
  firmName?: string | null
}

export function buildSystemFactsBlock(facts: SystemFacts): string {
  const jurisdictionLine = facts.jurisdiction
    ? `Governing jurisdiction: ${facts.jurisdiction.displayName} (source: ${
        facts.jurisdiction.source === 'matter'
          ? 'matter fact'
          : facts.jurisdiction.source === 'client_address'
            ? 'client address'
            : 'firm default'
      })`
    : 'Governing jurisdiction: NOT SET — do not assume any state; write "Governing law to be confirmed"'
  const lines = [jurisdictionLine, `Today's date: ${longDate(facts.todayIso)}`]
  if (facts.firmName?.trim()) lines.push(`Firm name: ${facts.firmName.trim()}`)
  return [
    '--- System facts (authoritative platform facts — ground the document in these; never contradict, guess around, or default to a different jurisdiction) ---',
    ...lines,
    // EDITOR-FIX-1 (item 5): the shared formatting/drafting standards ride the
    // SAME prepended block, so every path that assembles a draft through the
    // system-facts seam (AI draft + stage regenerate) carries them. Revise
    // injects FORMATTING_DIRECTIVES itself (reviseDraft.ts).
    '',
    FORMATTING_DIRECTIVES,
  ].join('\n')
}

export interface AssembleArgs {
  basePrompt: string
  template: string
  questionnaireResponses: Record<string, unknown>
  transcriptText: string
  documentKind: string
  // Generation integrity — resolved jurisdiction + today's date + firm name,
  // rendered by buildSystemFactsBlock. Prepended BEFORE the base prompt (the
  // model's first read), unlike skills/digest/guidance below which append.
  // Undefined only in tests exercising the pre-existing slot contract alone.
  systemFactsText?: string
  // Document-formatting standard (documentStyle.ts) — the professional
  // typography/structure rules the produced document must follow. A platform
  // rule, not attorney guidance, so it sits with the system facts at the TOP
  // (after them, before the base prompt), not in the append layers below.
  // Undefined in tests exercising the pre-existing slot contract alone.
  styleText?: string
  // Selected-skill bodies (buildActiveSkillsText) injected so a picked playbook is
  // guaranteed to apply. Empty string when none selected.
  activeSkillsText?: string
  // WP B1 — the rendered Service Digest (standing drafting preferences learned
  // from previously accepted edits on this service). Appears AFTER the skills
  // (a skill is an attorney-picked playbook; the digest is a softer, inferred
  // default) and BEFORE guidance (the attorney's instructions for THIS draft
  // always win). Undefined when there is nothing to inject.
  serviceDigestText?: string
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

  // The document-formatting standard is a platform rule about HOW to write the
  // document (not attorney guidance), so it rides at the top with the system
  // facts. Prepend it FIRST here, then the system facts, so the final order is
  // [system facts][style standard][base prompt] — facts (jurisdiction/date/firm)
  // lead, the style standard follows, both ahead of the base prompt and the
  // append layers below.
  if (args.styleText?.trim()) {
    prompt = `${args.styleText.trim()}\n\n${prompt}`
  }

  // System facts (jurisdiction, today, firm name) go FIRST — the model reads
  // them before anything else, and they are platform facts, not attorney
  // guidance, so they precede the skills/digest/guidance layers below rather
  // than joining their append order.
  if (args.systemFactsText?.trim()) {
    prompt = `${args.systemFactsText.trim()}\n\n${prompt}`
  }

  // Selected legal playbooks (force-applied), then the service digest (standing,
  // inferred preferences), then the attorney's own revision instructions LAST —
  // each layer outranks the one before it, ending with what the attorney typed
  // for THIS pass carrying the most weight.
  if (args.activeSkillsText?.trim()) {
    prompt += `\n\n${args.activeSkillsText.trim()}`
  }
  if (args.serviceDigestText?.trim()) {
    prompt += `\n\n${args.serviceDigestText.trim()}`
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
  // WP B1 — whether/how the Service Digest fired: null when not injected
  // (opted out, no serviceKey, no signals yet, or a swallowed assembly
  // failure), the watermark/section-count/char-count when it was. Folded into
  // the trace jsonb beside prompt_config — same "no schema change, full audit"
  // pattern. The digest TEXT itself already lives verbatim in `prompt`.
  serviceDigest?: ServiceDigestTraceMeta | null
  // Generation integrity — every `{{token}}` findUnresolvedTokens still found in
  // the produced body, recorded REGARDLESS of what the model's own `ambiguities`
  // list says (that list is free-text the model writes and can omit a token it
  // left in place; this is a deterministic scan of the actual output). Always
  // set by the caller (an empty array is the honest, expected, common case) —
  // see buildDraftTraceJson for the pre-existing-caller no-op guarantee.
  unresolvedTokens?: string[]
}

// PURE — the trace-jsonb fold, split out of persistReasoningTrace so it is
// testable without a database. Returns fullTrace UNCHANGED when there is
// nothing to add (byte-identical to the pre-WP-B1 behavior for any caller that
// never sets serviceDigest/unresolvedTokens).
export function buildDraftTraceJson(
  fullTrace: unknown,
  meta: {
    promptId?: string
    templateId?: string
    serviceDigest?: ServiceDigestTraceMeta | null
    unresolvedTokens?: string[]
  },
): unknown {
  const extras: Record<string, unknown> = {}
  if (meta.promptId || meta.templateId) {
    extras.prompt_config = {
      prompt_id: meta.promptId ?? null,
      template_id: meta.templateId ?? null,
    }
  }
  if (meta.serviceDigest !== undefined) {
    extras.service_digest = meta.serviceDigest
  }
  if (meta.unresolvedTokens !== undefined) {
    extras.unresolved_tokens = meta.unresolvedTokens
  }
  if (!Object.keys(extras).length || !fullTrace || typeof fullTrace !== 'object') return fullTrace
  return { ...(fullTrace as Record<string, unknown>), ...extras }
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistTraceArgs): Promise<string> {
  const id = randomUUID()
  const traceWithPromptId = buildDraftTraceJson(args.fullTrace, {
    promptId: args.promptId,
    templateId: args.templateId,
    serviceDigest: args.serviceDigest,
    unresolvedTokens: args.unresolvedTokens,
  })
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        ctx.actorId,
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
  const agentCtx = await resolveTenantAgentCtx(ctx)
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
