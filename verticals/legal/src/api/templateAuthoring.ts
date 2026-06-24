// AI authoring of a service's document TEMPLATE (Build-Wizard Phase 3) — the
// substrate-facing half of "the chatbot proposes a document template for an existing
// service". It mirrors intakeAuthoring.ts exactly: where that file authors the
// QUESTIONNAIRE, this authors the document body the questionnaire's answers merge
// into. The two together ARE the variable contract — every template {{token}} should
// map to a questionnaire field.id, or it renders [[MISSING]]. Three pieces:
//   • loadTemplateContext — a READ-ONLY context loader the chat tool gives the model:
//     the service's current questionnaire field.ids (so a proposed template's tokens
//     can be bound to existing questions), the service's existing document templates,
//     and the docKind registry (the kinds across the firm's templates). The model
//     reuses these field ids as its {{tokens}} instead of inventing new ones.
//   • validateProposedTemplate — wraps validateDocumentTemplate (the SAME write-path
//     guard the editor uses) AND extracts EVERY token the merge renderer would try to
//     fill (extractRenderedTokens — matches dotted paths too), then reports ORPHAN
//     tokens: a token with no matching questionnaire field.id. The contract is flat
//     snake_case, so a dotted token like {{member.0.name}} (which the flat answer map
//     can never fill — it renders [[MISSING]]) has no flat field to bind and is always
//     flagged as an orphan. Surfaced on the card before approval.
//   • createTemplateAI — the AI WRITE path. The chat turn never writes; this is
//     called by the attorney-gated approve route. It persists a reasoning_trace FIRST
//     (sourced to the Claude agent actor, confidence clamped < 1.0), then submits the
//     template-create's underlying action AS THE AGENT with intent 'exploration'
//     (proposing a new document is a creation/exploration) and the trace id.
//
// The template is SERVICE-BOUND per the wizard default: it is written into the
// service's own transitions.document_templates store (keyed by docKind), exactly the
// way the manual document-template editor binds a body to a service (updateDocument-
// Template) — so a freshly proposed body is part of that service's contract, not a
// loose library entity. Every AI write is sourced to the seeded Claude agent actor
// and traced (CLAUDE.md hard rule 4/7); no direct substrate SQL on the write path
// beyond the reasoning_trace insert.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  validateDocumentTemplate,
  getQuestionnaire,
  getDocumentTemplate,
  listServiceDocumentTemplates,
  type DocumentTemplateConfig,
  type ServiceField,
  type QuestionnaireDoc,
} from './services.js'
import { extractRenderedTokens } from '../lib/templates/render.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// the SAME id intakeAuthoring.ts / serviceAuthoring.ts source their writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// One of the service's existing document templates, summarized for the model.
export interface ExistingTemplateSummary {
  documentKind: string
  tokens: string[]
}

// The read-only context the chat tool hands the model to PROPOSE a template: the
// service's current questionnaire field ids (the tokens it may bind to), its
// existing templates, and the docKind registry across the firm's templates.
export interface TemplateAuthoringContext {
  serviceKey: string
  // The service's current questionnaire field ids — the model reuses these EXACT
  // tokens for its {{fill-ins}} so the template binds to real questions (no orphans).
  questionnaireFieldIds: string[]
  // The service's existing document templates (by docKind) + their tokens, so the
  // model doesn't propose a duplicate or clash with an authored body.
  existingTemplates: ExistingTemplateSummary[]
  // Distinct document kinds across the FIRM's service templates — the docKind
  // registry a proposed template's kind should come from (or extend deliberately).
  docKinds: string[]
}

// Every field id in a questionnaire schema, including members_repeater member
// fields (those bind tokens too). Lower-cased — token comparison is case-insensitive
// (renderTemplate lower-cases both sides), and field/token ids are snake_case slugs.
function collectFieldIds(schema: QuestionnaireDoc | null): string[] {
  if (!schema) return []
  const ids: string[] = []
  const seen = new Set<string>()
  const visit = (fields: ServiceField[] | undefined): void => {
    for (const f of fields ?? []) {
      const id = (f.id ?? '').toLowerCase()
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
      if (f.memberFields) visit(f.memberFields)
    }
  }
  for (const s of schema.sections ?? []) visit(s.fields)
  return ids
}

// Load everything the model needs to PROPOSE a document template for a service: the
// questionnaire field ids (the tokens it may bind to), the existing templates, and
// the docKind registry. Read-only.
export async function loadTemplateContext(
  ctx: ActionContext,
  serviceKey: string,
): Promise<TemplateAuthoringContext> {
  const schema = await getQuestionnaire(ctx, serviceKey)
  const questionnaireFieldIds = collectFieldIds(schema)
  const docs = await listServiceDocumentTemplates(ctx, serviceKey)
  const existingTemplates = docs.map((d) => ({
    documentKind: d.documentKind,
    tokens: extractRenderedTokens(d.body),
  }))
  // The firm-wide docKind registry: every kind any service has authored a template
  // for (this service's included). De-duplicated and sorted for a stable list.
  const docKinds = [...new Set(existingTemplates.map((t) => t.documentKind))].sort()
  return { serviceKey, questionnaireFieldIds, existingTemplates, docKinds }
}

// The result of validating a proposed template: the shape error (from the SAME
// validateDocumentTemplate the editor uses) PLUS the extracted {{tokens}} and the
// ORPHANS — tokens with no matching questionnaire field.id (would render [[token]]).
export interface ProposedTemplateValidation {
  ok: boolean
  errors: string[]
  // Every distinct {{token}} the body references (flat snake_case, first-seen order).
  tokens: string[]
  // Tokens with NO matching questionnaire field id — would render [[MISSING]]. A
  // broken half of the variable contract; surfaced on the card before approval.
  orphanTokens: string[]
}

// Validate a proposed template body the write path will persist: non-empty text
// (validateDocumentTemplate throws — caught and surfaced as a single error), then
// extract its {{tokens}} via the real flat extractor and flag the orphans against
// the supplied questionnaire field ids. An orphan is NOT a hard error (the attorney
// may approve a body whose questions come later), so `ok` reflects only the shape.
export function validateProposedTemplate(
  body: unknown,
  fieldIds: readonly string[],
): ProposedTemplateValidation {
  const errors: string[] = []
  let validated: string | null = null
  try {
    validated = validateDocumentTemplate(body)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  if (validated === null) {
    return { ok: false, errors, tokens: [], orphanTokens: [] }
  }
  const tokens = extractRenderedTokens(validated)
  const known = new Set(fieldIds.map((f) => f.toLowerCase()))
  const orphanTokens = tokens.filter((t) => !known.has(t.toLowerCase()))
  return { ok: errors.length === 0, errors, tokens, orphanTokens }
}

// Reasoning summary the approve route carries from the chat turn that produced the
// proposal — WHY this template, plus an honest confidence the substrate clamps below
// 1.0 (an AI never claims certainty).
export interface TemplateReasoning {
  conclusion: string
  evidence?: unknown[]
  alternatives?: unknown[]
  confidence?: number
  modelIdentity?: string
}

// The proposed template shape the create path persists. `docKind` is the binding key
// in the service's document_templates store; `name`/`category` are descriptive
// metadata carried for the card (the store is keyed by docKind, like the editor).
export interface CreateTemplateAIInput {
  name: string
  body: string
  docKind: string
  category?: 'document'
}

// Persist a reasoning_trace for an AI template write (mirrors intakeAuthoring's):
// sourced to the Claude agent actor, confidence clamped strictly below 1.0. Returns
// the trace id.
async function persistReasoningTrace(
  ctx: ActionContext,
  serviceKey: string,
  input: CreateTemplateAIInput,
  reasoning: TemplateReasoning,
): Promise<string> {
  const id = randomUUID()
  const conclusion =
    reasoning.conclusion?.trim() ||
    `Authored the "${input.docKind}" document template for ${serviceKey}.`
  const prompt = `Author the "${input.docKind}" document template for the service "${serviceKey}".`
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
        prompt,
        JSON.stringify(reasoning.evidence ?? []),
        JSON.stringify(reasoning.alternatives ?? []),
        conclusion,
        clampConfidence(reasoning.confidence),
        reasoning.modelIdentity ?? 'claude',
        JSON.stringify({ serviceKey, ...input, ...reasoning }),
      ],
    )
  })
  return id
}

// The AI write path (the live write happens ONLY on attorney approve). Validates the
// body (non-empty), persists the reasoning_trace FIRST, then submits the template
// write AS THE AGENT ACTOR with intent 'exploration' and the trace id. The write is
// legal.service.upsert with a document_templates transitions_patch keyed by docKind —
// the SAME versioned, service-bound path updateDocumentTemplate uses — submitted here
// directly so the action carries the agent source + trace + intent (vs. the
// attorney's manual updateDocumentTemplate, which has no trace). The existing
// templates for OTHER kinds are preserved by merging into the current config.
export async function createTemplateAI(
  ctx: ActionContext,
  serviceKey: string,
  input: CreateTemplateAIInput,
  reasoning: TemplateReasoning,
): Promise<{ serviceKey: string; documentKind: string }> {
  const docKind = (input.docKind ?? '').trim()
  if (!docKind) throw new Error('A document kind is required to author a template.')
  // Validate the body BEFORE any write (incl. the trace) so an invalid proposal
  // leaves no trace row behind.
  const body = validateDocumentTemplate(input.body)

  // Read the current row to MERGE into its document_templates (so other kinds'
  // bodies survive) and to get the display_name the upsert requires.
  const row = await withActionContext(ctx, async (client) => {
    const res = await client.query<{
      display_name: string
      transitions: { document_templates?: DocumentTemplateConfig }
    }>(
      `SELECT display_name, transitions FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0] ?? null
  })
  if (!row) throw new Error(`Service not found: ${serviceKey}`)

  const existing: DocumentTemplateConfig = row.transitions.document_templates ?? {}
  const nextVersion =
    (typeof existing.template_version === 'number' ? existing.template_version : 0) + 1
  const merged: DocumentTemplateConfig = {
    template_version: nextVersion,
    templates: { ...(existing.templates ?? {}), [docKind]: body },
  }

  // The write is AS THE AGENT — the trace, the action source, and the
  // configuration_change all attribute the authoring to the Claude agent actor.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const reasoningTraceId = await persistReasoningTrace(
    agentCtx,
    serviceKey,
    { name: input.name, body, docKind, category: 'document' },
    reasoning,
  )

  await submitAction(agentCtx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'exploration',
    reasoningTraceId,
    payload: {
      service_key: serviceKey,
      display_name: row.display_name,
      transitions_patch: { document_templates: merged },
    },
  })

  const saved = await getDocumentTemplate(agentCtx, serviceKey, docKind)
  if (!saved) throw new Error(`Document template not found after write: ${serviceKey}`)
  return { serviceKey, documentKind: docKind }
}

// Honest confidence: an AI authoring write must never claim certainty (ADR 0006).
// Capped at 0.99 (never 1.0), with a humble 0.6 fallback when no value is given.
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
