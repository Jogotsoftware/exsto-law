import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { chatWithAssistantDetailed, streamChatWithAssistant } from '../adapters/claude.js'
import { withSkills, loadForcedSkills, buildActiveSkillsText } from './skillContext.js'
import { DOCUMENT_STYLE_INSTRUCTION } from '../templates/documentStyle.js'
import { resolveConcreteAssistantModelId, resolveModelForTask } from '../lib/modelRouter.js'
import {
  getStandaloneTemplate,
  type StandaloneTemplate,
  type StandaloneTemplateCategory,
  type TemplateSignature,
  type TemplateEsignConfig,
  type TemplateVariables,
} from '../queries/templates.js'

// Write API for standalone templates (beta sprint Obj 9). Create/update go through
// the legal.template.* actions; archive reuses the core entity.archive. Each
// returns the resolved template so the UI can render immediately.

export interface CreateTemplateInput {
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind?: string | null
  variables?: TemplateVariables
  // ESIGN-BLOCK-1 (WP1) — does the finished document get signed, and by whom?
  // Omitted = unsigned (the read default). Superseded by esignConfig below
  // (ES-3, §6.1); kept so the legacy write path (older callers, MCP tools that
  // haven't moved to the new shape) still works.
  signature?: TemplateSignature
  // ESIGN-UNIFY-1 ES-3 (0187 planned) — the full role/bind/order declaration.
  // Omitted = the read layer falls back to `signature` above (or unsignable).
  esignConfig?: TemplateEsignConfig
}

export async function createTemplate(
  ctx: ActionContext,
  input: CreateTemplateInput,
): Promise<StandaloneTemplate> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.template.create',
    intentKind: 'enforcement',
    payload: {
      name: input.name,
      category: input.category,
      body: input.body,
      doc_kind: input.docKind ?? null,
      variables: input.variables,
      signature: input.signature,
      esign_config: input.esignConfig,
    },
  })
  const { templateEntityId } = res.effects[0] as { templateEntityId: string }
  const created = await getStandaloneTemplate(ctx, templateEntityId)
  if (!created) throw new Error('Template created but could not be read back.')
  return created
}

export interface UpdateTemplateInput {
  templateEntityId: string
  name?: string
  body?: string
  docKind?: string | null
  variables?: TemplateVariables
  signature?: TemplateSignature
  esignConfig?: TemplateEsignConfig
}

export async function updateTemplate(
  ctx: ActionContext,
  input: UpdateTemplateInput,
): Promise<StandaloneTemplate> {
  await submitAction(ctx, {
    actionKindName: 'legal.template.update',
    intentKind: 'adjustment',
    payload: {
      template_entity_id: input.templateEntityId,
      name: input.name,
      body: input.body,
      doc_kind: input.docKind,
      variables: input.variables,
      signature: input.signature,
      esign_config: input.esignConfig,
    },
  })
  const updated = await getStandaloneTemplate(ctx, input.templateEntityId)
  if (!updated) throw new Error('Template updated but could not be read back.')
  // Phase 10 (UI-BUILDER-FIX-1): template ⇄ questionnaire sync. A body edit that
  // introduces fill-in tokens the feeding questionnaire doesn't capture confirms/
  // creates the questionnaire_feeds_template edge and enqueues (worker_job) an AI
  // rebuild PROPOSAL for the questionnaire — approval-gated, never auto-applied.
  // Best-effort: a sync failure never fails the save.
  if (typeof input.body === 'string' && input.body.trim()) {
    try {
      const { syncQuestionnaireForTemplate } = await import('./templateQuestionnaireSync.js')
      await syncQuestionnaireForTemplate(ctx, input.templateEntityId, input.body)
    } catch (err) {
      console.error('updateTemplate: questionnaire sync failed (non-fatal)', err)
    }
  }
  return updated
}

// AI template generation — drafting from a description OR enhancing an existing
// body — uses the firm's Settings-managed Anthropic key (claude.ts owns all
// Anthropic traffic). Pure generation: it returns text the attorney reviews and
// saves; it writes nothing to the substrate (the SAVE is the recorded write). The
// model is instructed to emit {{merge_tokens}} for fill-ins.
//
// IMPORTANT (504 fix): a full document (e.g. an Operating Agreement) takes far
// longer to generate than a serverless gateway will hold a synchronous request,
// so the UI uses the STREAMING path (streamTemplateAi) over SSE. The synchronous
// aiDraftTemplate/aiEnhanceTemplate remain for the MCP tools and short outputs.
export interface AiDraftTemplateInput {
  instructions: string
  category: StandaloneTemplateCategory
  // Skills the attorney explicitly picked in the modal — force-loaded (their full
  // instructions injected) on top of the model's own load_skill auto-routing.
  skillSlugs?: string[]
  // `${provider}:${model}` from legal.assistant.models. Defaults to the firm
  // default; the modal defaults this to the cheapest available model.
  modelId?: string
}

export interface AiEnhanceTemplateInput {
  // The current template body to improve. Empty ⇒ draft fresh from instructions.
  currentBody: string
  // What to change ("add a severability clause", "make it more formal"). Optional:
  // omitted ⇒ a general polish/tighten pass.
  instructions?: string
  category: StandaloneTemplateCategory
  // Field ids on the bound questionnaire — the model reuses these exact tokens for
  // fill-ins instead of inventing new ones (keeps the template's bindings intact).
  fieldIds?: string[]
  skillSlugs?: string[]
  modelId?: string
}

// Unified streaming input: draft (from instructions) or enhance (revise a body).
export interface TemplateAiStreamInput {
  mode: 'draft' | 'enhance'
  category: StandaloneTemplateCategory
  instructions?: string
  currentBody?: string
  fieldIds?: string[]
  skillSlugs?: string[]
  modelId?: string
}

// Build the system prompt + user message + tools + model for a template-AI run.
// Single source of truth for the draft and enhance prompts so the streaming and
// synchronous paths are identical.
async function buildTemplateAiPrompt(
  ctx: ActionContext,
  input: TemplateAiStreamInput,
): Promise<{
  system: string
  userMsg: string
  clientTools: Awaited<ReturnType<typeof withSkills>>['clientTools']
  model: string
}> {
  const kind = input.category === 'email' ? 'email' : 'legal document'
  const instructions = input.instructions?.trim()
  const currentBody = input.currentBody?.trim() ?? ''
  const fieldList = (input.fieldIds ?? []).map((f) => f.trim()).filter(Boolean)

  let baseSystem: string
  let userMsg: string
  if (input.mode === 'enhance') {
    if (!currentBody && !instructions)
      throw new Error('Nothing to work from — write a draft or describe what you want.')
    baseSystem = [
      `You revise reusable ${kind} TEMPLATES for a US law firm.`,
      'Output the REVISED template body ONLY — no preamble, no explanation, no markdown code fences.',
      'Preserve every existing {{merge_token}} that still applies; keep their exact snake_case names.',
      'Wherever a value is filled in per client or matter, use a {{merge_token}} in double curly braces',
      'with a snake_case name, e.g. {{client_name}}, {{effective_date}}; reuse a token name when a value recurs.',
      fieldList.length
        ? `When a fill-in matches one of these existing questionnaire fields, bind to it by reusing its exact token: ${fieldList
            .map((f) => `{{${f}}}`)
            .join(', ')}.`
        : '',
      'Keep clear headings and short paragraphs; practical and ready to edit.',
      'Never fabricate statutes, code sections, case names, or citations. Where a specific legal',
      'citation would go, prefer a {{citation}} merge token or general phrasing the attorney can',
      'verify; do not invent a section number.',
    ]
      .filter(Boolean)
      .join(' ')
    userMsg = currentBody
      ? `Current template:\n\n${currentBody}\n\n---\nRevision request: ${
          instructions ||
          'Polish and tighten the language, fix structure and formatting, keep all merge tokens.'
        }`
      : `Draft a new ${kind} template. Request: ${instructions}`
  } else {
    if (!instructions) throw new Error('Describe the template you want drafted.')
    baseSystem = [
      `You draft reusable ${kind} TEMPLATES for a US law firm.`,
      'Output the template body ONLY — no preamble, no explanation, no markdown code fences.',
      'Wherever a value is filled in per client or matter, insert a merge token in double',
      'curly braces with a snake_case name, e.g. {{client_name}}, {{firm_name}},',
      '{{matter_number}}, {{effective_date}}. Reuse the same token name when a value recurs.',
      fieldList.length
        ? `Prefer these existing questionnaire field tokens for fill-ins: ${fieldList
            .map((f) => `{{${f}}}`)
            .join(', ')}.`
        : '',
      'Use clear headings and short paragraphs; keep it practical and ready to edit.',
      'Never fabricate statutes, code sections, case names, or citations. Where a specific',
      'legal citation would go, prefer a {{citation}} merge token or general phrasing the',
      'attorney can verify; do not invent a section number.',
    ]
      .filter(Boolean)
      .join(' ')
    userMsg = instructions
  }

  // Hold legal-document templates to the same professional formatting standard as
  // generated drafts (a template is the pattern the finished document renders
  // from). Skipped for email templates — the standard's title/section/signature
  // conventions don't fit an email body.
  if (input.category !== 'email') {
    baseSystem = `${baseSystem}\n\n${DOCUMENT_STYLE_INSTRUCTION}`
  }

  // Skill-aware (load_skill auto-routing) + any force-picked skills.
  const { system: catalogSystem, clientTools } = await withSkills(ctx, baseSystem)
  const forced = await loadForcedSkills(ctx, input.skillSlugs)
  const activeText = buildActiveSkillsText(forced)
  const system = activeText ? `${catalogSystem}\n\n${activeText}` : catalogSystem
  // AI-CONTEXT C1 fix: this used to be `resolveAssistantModel(input.modelId)?.model`,
  // which returned the CATALOG's literal 'auto' placeholder unresolved when the
  // attorney picked the Auto tier — sending the string 'auto' to the Anthropic
  // API as a model id. resolveConcreteAssistantModelId resolves Auto (via
  // chooseAutoModel) before it can reach the adapter; no explicit pick falls
  // back to this task's registry default (LEGAL_DRAFTING_MODEL-eligible).
  const resolvedModelId = input.modelId
    ? resolveConcreteAssistantModelId(input.modelId, { message: userMsg })
    : null
  const model = resolvedModelId ?? resolveModelForTask('template_ai').model
  return { system, userMsg, clientTools, model }
}

// STREAMING template generation (the path the UI uses). Yields the body text as it
// is produced, so the gateway never times out on a long document and the attorney
// sees progress. Drops thinking/tool/citation chunks — only the body text matters.
export async function* streamTemplateAi(
  ctx: ActionContext,
  input: TemplateAiStreamInput,
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'thinking'; text: string }> {
  const { system, userMsg, clientTools, model } = await buildTemplateAiPrompt(ctx, input)
  for await (const chunk of streamChatWithAssistant(
    ctx.tenantId,
    [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
    { clientTools, model },
  )) {
    if (chunk.type === 'text') yield { type: 'text', text: chunk.text }
    else if (chunk.type === 'thinking') yield { type: 'thinking', text: chunk.text }
  }
}

export async function aiDraftTemplate(
  ctx: ActionContext,
  input: AiDraftTemplateInput,
): Promise<{ body: string }> {
  const { system, userMsg, clientTools, model } = await buildTemplateAiPrompt(ctx, {
    mode: 'draft',
    category: input.category,
    instructions: input.instructions,
    skillSlugs: input.skillSlugs,
    modelId: input.modelId,
  })
  const { reply } = await chatWithAssistantDetailed(
    ctx.tenantId,
    [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
    { clientTools, model },
  )
  return { body: reply.trim() }
}

export async function aiEnhanceTemplate(
  ctx: ActionContext,
  input: AiEnhanceTemplateInput,
): Promise<{ body: string }> {
  const { system, userMsg, clientTools, model } = await buildTemplateAiPrompt(ctx, {
    mode: 'enhance',
    category: input.category,
    instructions: input.instructions,
    currentBody: input.currentBody,
    fieldIds: input.fieldIds,
    skillSlugs: input.skillSlugs,
    modelId: input.modelId,
  })
  const { reply } = await chatWithAssistantDetailed(
    ctx.tenantId,
    [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ],
    { clientTools, model },
  )
  return { body: reply.trim() }
}

// Retire a standalone template (HARDENING-RESIDUALS-1 WP-F): soft, through the
// legal.template.retire action (migration 0150), mirroring legal.service.retire.
// The handler BLOCKS while the template is attached to an active service or fed
// by a questionnaire — the error names the holder ("in use by X") so the
// attorney detaches there first. Document drafts already generated survive.
export async function retireTemplate(
  ctx: ActionContext,
  templateEntityId: string,
): Promise<{ templateEntityId: string; retired: true }> {
  await submitAction(ctx, {
    actionKindName: 'legal.template.retire',
    intentKind: 'enforcement',
    payload: { template_entity_id: templateEntityId },
  })
  return { templateEntityId, retired: true }
}

// Archive a standalone template through the core entity.archive action (status
// 'archived' — kept as history, dropped from active listings). Append-only.
// Prefer retireTemplate above (it refuses while the template is in use);
// archive remains for callers that have already detached everything.
export async function archiveTemplate(
  ctx: ActionContext,
  templateEntityId: string,
): Promise<{ templateEntityId: string; archived: true }> {
  await archiveEntity(ctx, templateEntityId)
  return { templateEntityId, archived: true }
}
