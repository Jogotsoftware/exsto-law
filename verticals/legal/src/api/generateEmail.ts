// MACHINE-COMMS-1 (WP2) — EMAIL GENERATION: the machine's voice. Compose an
// outbound email draft for a matter — AI-drafted from matter facts + the client's
// ASSEMBLED HISTORY (getClientContext, archived matters included) + attorney
// instructions + firm skills, or a deterministic template merge for canned sends —
// and persist it through the EXISTING draft.generate/draft.merge actions on the
// COMMUNICATION channel (handlers/draft.ts): a communication_draft entity whose
// versions land in the attorney review queue. Approve = send (api/reviewDraft.ts →
// api/email.ts sendCommunicationDraft → Contract B mail.send). Nothing reaches a
// client unapproved — the same law as documents.
//
// WORKER-ONLY for the model path: composeEmailDraft is called by the
// email_generation capability handler (capabilityRuntime) and the ad-hoc
// capability job — never in a request.
import { randomUUID } from 'node:crypto'
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { callClaudeDrafter, type ClaudeDraftResult } from '../adapters/claude.js'
import {
  checkEmailVoice,
  buildVoiceCorrectionSection,
  type VoiceViolation,
} from './emailVoiceChecks.js'
import { loadEmailDraftingPrompt } from '../templates/loader.js'
import { getMatter } from '../queries/matters.js'
import { getClientContext, formatClientContext } from '../queries/clientContext.js'
import { getStandaloneTemplate } from '../queries/templates.js'
import { renderTemplate, buildMergeData } from './templateMerge.js'
import {
  loadForcedSkills,
  buildActiveSkillsText,
  resolveJurisdictionSkillSlugs,
} from './skillContext.js'

const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// The communication draft's document_kind label (payload data, not a registry kind).
export const CLIENT_EMAIL_DOCUMENT_KIND = 'client_email'

export type EmailGenerationMode = 'ai_draft' | 'template'

export interface ComposeEmailDraftInput {
  matterEntityId: string
  // What the email is FOR — the attorney's purpose/instructions. Required for
  // ai_draft; optional flavor for template mode.
  purpose?: string
  recipientRole?: 'client' | 'other'
  mode?: EmailGenerationMode
  // template mode: the firm-library template entity id (exact id, never a name).
  templateEntityId?: string
  // Regenerate: write the new draft as version n+1 on this existing entity,
  // carrying the attorney's revision notes as guidance.
  supersedesDocumentEntityId?: string
  guidance?: string
}

export interface ComposeEmailDraftResult {
  documentVersionId: string | null
  documentEntityId: string | null
  subject: string
  mode: EmailGenerationMode
}

// Pure parser for the model's output contract (exported for tests): a leading
// `SUBJECT: …` line, a blank line, then the body. A missing subject line falls
// back deterministically — the attorney edits at review, never a silent guess
// presented as the model's.
export function parseEmailDraftOutput(
  raw: string,
  fallbackSubject: string,
): { subject: string; body: string } {
  const text = raw.trim()
  const m = text.match(/^SUBJECT:\s*(.+)\s*$/im)
  if (!m) return { subject: fallbackSubject, body: text }
  const subject = m[1]!.trim() || fallbackSubject
  const body = text
    .slice(text.indexOf(m[0]!) + m[0]!.length)
    .replace(/^\s+/, '')
    .trim()
  return { subject, body: body || text }
}

export async function composeEmailDraft(
  ctx: ActionContext,
  input: ComposeEmailDraftInput,
): Promise<ComposeEmailDraftResult> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const mode: EmailGenerationMode = input.mode === 'template' ? 'template' : 'ai_draft'
  const recipientRole = input.recipientRole === 'other' ? 'other' : 'client'

  const matter = await getMatter(agentCtx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)
  const fallbackSubject = `Update on your matter ${matter.matterNumber}`

  if (mode === 'template') {
    const templateEntityId = (input.templateEntityId ?? '').trim()
    if (!templateEntityId) {
      throw new Error(
        'email_generation in template mode names no template — set template_entity_id to the exact firm template entity id.',
      )
    }
    const tmpl = await getStandaloneTemplate(agentCtx, templateEntityId)
    if (!tmpl || !tmpl.body.trim()) {
      throw new Error(
        `Email template "${templateEntityId}" is not an active firm template (not found or empty body).`,
      )
    }
    const merged = renderTemplate(
      tmpl.body,
      buildMergeData(matter, { effectiveDateIso: new Date().toISOString() }),
    )
    // A template body may pin its own subject with a leading SUBJECT: line;
    // otherwise the template's name is the subject.
    const parsed = parseEmailDraftOutput(merged.markdown, tmpl.name)
    const result = await submitAction(agentCtx, {
      actionKindName: 'draft.merge',
      intentKind: 'enforcement',
      payload: {
        matter_entity_id: input.matterEntityId,
        document_kind: CLIENT_EMAIL_DOCUMENT_KIND,
        document_markdown: parsed.body,
        jurisdiction: 'NC',
        template_id: `template:${templateEntityId}`,
        missing_fields: merged.missingFields,
        supersedes_document_entity_id: input.supersedesDocumentEntityId ?? null,
        channel: 'communication',
        email_subject: parsed.subject,
        email_to_role: recipientRole,
      },
    })
    return finishResult(result, parsed.subject, mode)
  }

  const purpose = (input.purpose ?? '').trim()
  if (!purpose) {
    throw new Error('email_generation needs a purpose — what should this email tell the recipient?')
  }

  // Client memory ALWAYS rides the email prompt (WP1.4 — this consumer is
  // unconditional by design). No client parent → an honest empty marker.
  let clientContextText = '(no client history on file for this matter)'
  if (matter.clientEntityId) {
    const context = await getClientContext(agentCtx, matter.clientEntityId)
    if (context) clientContextText = formatClientContext(context)
  }

  const matterFacts = {
    matter_number: matter.matterNumber,
    service_key: matter.serviceKey,
    matter_status: matter.status,
    client_name: matter.clientName || null,
    intake_answers: matter.questionnaireResponses ?? {},
  }

  // Function replacers (assembleReviewPrompt precedent): every slotted value is
  // untrusted content — `$&`-style replacement patterns must be inert.
  let prompt = loadEmailDraftingPrompt()
    .replaceAll('{{purpose}}', () => purpose)
    .replaceAll('{{recipient_role}}', () => recipientRole)
    .replaceAll('{{matter_facts_json}}', () => JSON.stringify(matterFacts, null, 2))
    .replaceAll('{{client_context}}', () => clientContextText)

  const autoSkillSlugs = await resolveJurisdictionSkillSlugs(agentCtx, {
    documentKind: CLIENT_EMAIL_DOCUMENT_KIND,
    jurisdiction: 'NC',
  })
  const skillsText = buildActiveSkillsText(await loadForcedSkills(agentCtx, autoSkillSlugs))
  if (skillsText.trim()) prompt += `\n\n${skillsText.trim()}`
  if (input.guidance?.trim()) {
    prompt +=
      `\n\n--- Attorney revision notes (apply these; they take precedence where they conflict) ---\n` +
      input.guidance.trim()
  }

  // STYLE-FIX-2 — bind, don't just steer: a deterministic house-voice check
  // (emailVoiceChecks.ts, mirroring templates/house-voice.md) after the parse,
  // ONE corrective regenerate naming the exact violations, then flag-and-queue.
  // Never a rewrite, never a block — a still-failing draft reaches the attorney
  // flagged, and a clean pass records voice_violations: [] so the receipt is
  // queryable either way.
  let chosen = await callClaudeDrafter(agentCtx.tenantId, {
    prompt,
    maxTokens: 4000,
    task: 'email_generate',
  })
  let promptUsed = prompt
  let parsed = parseEmailDraftOutput(chosen.documentMarkdown, fallbackSubject)
  let violations = checkEmailVoice(parsed.subject, parsed.body)
  let firstPassViolations: VoiceViolation[] | null = null
  let regenerated = false
  if (violations.length > 0) {
    firstPassViolations = violations
    try {
      const retryPrompt = prompt + buildVoiceCorrectionSection(parsed, violations)
      const retry = await callClaudeDrafter(agentCtx.tenantId, {
        prompt: retryPrompt,
        maxTokens: 4000,
        task: 'email_generate',
      })
      const reparsed = parseEmailDraftOutput(retry.documentMarkdown, fallbackSubject)
      chosen = retry
      promptUsed = retryPrompt
      parsed = reparsed
      violations = checkEmailVoice(reparsed.subject, reparsed.body)
      regenerated = true
    } catch {
      // The retry died (model/API error). Keep draft 1 with its violations —
      // voice_regenerated: false in the payload is the honest record of the
      // failed attempt, and the flagged draft still reaches the queue.
    }
  }
  const reasoningTraceId = await persistEmailTrace(agentCtx, { prompt: promptUsed, result: chosen })

  const result = await submitAction(agentCtx, {
    actionKindName: 'draft.generate',
    intentKind: 'enforcement',
    reasoningTraceId,
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: CLIENT_EMAIL_DOCUMENT_KIND,
      document_markdown: parsed.body,
      model_identity: chosen.modelIdentity,
      reasoning_trace_id: reasoningTraceId,
      jurisdiction: 'NC',
      confidence: clampConfidence(chosen.reasoningTrace.confidence),
      supersedes_document_entity_id: input.supersedesDocumentEntityId ?? null,
      channel: 'communication',
      email_subject: parsed.subject,
      email_to_role: recipientRole,
      voice_violations: violations,
      ...(firstPassViolations
        ? {
            voice_regenerated: regenerated,
            voice_first_pass_violations: firstPassViolations,
          }
        : {}),
      usage: {
        input_tokens: chosen.usage.inputTokens,
        output_tokens: chosen.usage.outputTokens,
        cache_creation_tokens: chosen.usage.cacheCreationTokens,
        cache_read_tokens: chosen.usage.cacheReadTokens,
      },
    },
  })
  return finishResult(result, parsed.subject, mode)
}

function finishResult(
  action: ActionResult,
  subject: string,
  mode: EmailGenerationMode,
): ComposeEmailDraftResult {
  const effects = (action.effects[0] ?? {}) as {
    documentVersionId?: string
    draftEntityId?: string
  }
  return {
    documentVersionId: effects.documentVersionId ?? null,
    documentEntityId: effects.draftEntityId ?? null,
    subject,
    mode,
  }
}

async function persistEmailTrace(
  ctx: ActionContext,
  args: { prompt: string; result: ClaudeDraftResult },
): Promise<string> {
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
        JSON.stringify(args.result.reasoningTrace.evidence ?? []),
        JSON.stringify(args.result.reasoningTrace.alternatives_considered ?? []),
        args.result.reasoningTrace.conclusion ?? '',
        clampConfidence(args.result.reasoningTrace.confidence),
        args.result.modelIdentity,
        JSON.stringify({
          ...(args.result.reasoningTrace as unknown as Record<string, unknown>),
          prompt_config: { prompt_id: 'email-drafting@repo', kind: 'email_generation' },
        }),
      ],
    )
  })
  return id
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0.5
  return Math.min(1, Math.max(0, n))
}
