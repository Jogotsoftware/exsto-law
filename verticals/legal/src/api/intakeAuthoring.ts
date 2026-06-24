// AI authoring of a service's intake QUESTIONNAIRE (Build-Wizard Phase 2) — the
// substrate-facing half of "the chatbot proposes the intake form for an existing
// service". It mirrors serviceAuthoring.ts exactly, one layer DOWN: where that file
// CREATES the empty service shell, this file fills that shell's intake schema. Three
// pieces:
//   • loadQuestionnaireContext — a READ-ONLY context loader the chat tool gives the
//     model: the closed KNOWN_FIELD_TYPES, the service's current intake schema (if
//     any), the service's DOCUMENT TEMPLATES and the {{tokens}} they reference (so
//     the model can build a questionnaire that COVERS them — the variable contract),
//     and the firm's questionnaire/question library (to reuse). The model composes a
//     questionnaire ONLY from these field types; it never invents a type.
//   • validateProposedQuestionnaire — wraps validateIntakeSchema (the SAME write-path
//     guard the manual editor uses) AND computes token-symmetry against the service's
//     templates: a template token with no matching field.id is MISSING-FOR-TOKENS
//     (would render [[token]] in the document), a field that no template references is
//     UNUSED. This is the variable contract, surfaced so the attorney never approves
//     a questionnaire that doesn't cover its documents.
//   • createQuestionnaireAI — the AI WRITE path. The chat turn never writes; this is
//     called by the attorney-gated approve route. It persists a reasoning_trace FIRST
//     (sourced to the Claude agent actor, confidence clamped < 1.0), then submits
//     legal.service.questionnaire.update's underlying action AS THE AGENT with intent
//     'adjustment' (filling a service's intake is an adjustment, not a creation) and
//     the trace id.
//
// Every AI write here is sourced to the seeded Claude agent actor and traced — the
// same contract serviceAuthoring.ts / workflowAuthoring.ts follow (CLAUDE.md hard
// rule 4/7). No direct substrate SQL on the write path beyond the reasoning_trace
// insert (the action layer's own pattern, copied from serviceAuthoring); the schema
// itself is written by the action layer (legal.service.upsert with an intake_schema
// transitions_patch, via updateQuestionnaire).
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  KNOWN_FIELD_TYPES,
  validateIntakeSchema,
  getQuestionnaire,
  listServiceDocumentTemplates,
  type QuestionnaireDoc,
  type ServiceField,
} from './services.js'
import { extractRenderedTokens } from '../lib/templates/render.js'
import { listQuestionnaireTemplates } from '../queries/questionnaireLibrary.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// the SAME id serviceAuthoring.ts / workflowAuthoring.ts source their writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// One of the service's configured document templates plus the flat {{tokens}} it
// references — the model uses this to build a questionnaire that COVERS the tokens.
export interface TemplateTokenSummary {
  documentKind: string
  tokens: string[]
}

// A reusable questionnaire the firm has saved, surfaced so the model can mirror an
// existing form's structure instead of inventing one from scratch.
export interface LibraryQuestionnaireSummary {
  questionnaireTemplateId: string
  name: string
  fieldCount: number
}

// The read-only context the chat tool hands the model to PROPOSE a questionnaire:
// the closed field-type vocabulary, the service's current schema (if any), the
// service's document templates + their tokens (the contract to cover), and the
// firm's questionnaire library (to reuse).
export interface QuestionnaireAuthoringContext {
  serviceKey: string
  // The closed set of field types validateIntakeSchema accepts — the model emits
  // ONLY these (anything else fails the same write-path guard the editor applies).
  fieldTypes: readonly string[]
  // The service's current intake schema, or null when nothing is authored yet.
  currentSchema: QuestionnaireDoc | null
  // The service's configured document templates and the tokens each references —
  // the variable contract the proposed questionnaire must cover.
  templates: TemplateTokenSummary[]
  // Every distinct token across all the service's templates — the union the
  // questionnaire must cover (so the model sees the full target at a glance).
  templateTokens: string[]
  // The firm's saved questionnaires, to reuse instead of inventing structure.
  library: LibraryQuestionnaireSummary[]
}

// All distinct flat {{tokens}} referenced by a service's configured document
// templates, first-seen order, de-duplicated. The TARGET the questionnaire covers.
export async function loadServiceTemplateTokens(
  ctx: ActionContext,
  serviceKey: string,
): Promise<{ templates: TemplateTokenSummary[]; tokens: string[] }> {
  const docs = await listServiceDocumentTemplates(ctx, serviceKey)
  const templates = docs.map((d) => ({
    documentKind: d.documentKind,
    tokens: extractRenderedTokens(d.body),
  }))
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const t of templates) {
    for (const tok of t.tokens) {
      if (!seen.has(tok)) {
        seen.add(tok)
        tokens.push(tok)
      }
    }
  }
  return { templates, tokens }
}

// Load everything the model needs to PROPOSE a questionnaire for a service: the
// closed field-type vocabulary, the current schema, the document templates + their
// tokens (the contract), and the firm's questionnaire library. Read-only.
export async function loadQuestionnaireContext(
  ctx: ActionContext,
  serviceKey: string,
): Promise<QuestionnaireAuthoringContext> {
  const currentSchema = await getQuestionnaire(ctx, serviceKey)
  const { templates, tokens } = await loadServiceTemplateTokens(ctx, serviceKey)
  const library = (await listQuestionnaireTemplates(ctx)).map((q) => ({
    questionnaireTemplateId: q.questionnaireTemplateId,
    name: q.name,
    fieldCount: q.fieldCount,
  }))
  return {
    serviceKey,
    fieldTypes: KNOWN_FIELD_TYPES,
    currentSchema,
    templates,
    templateTokens: tokens,
    library,
  }
}

// Every field id in a questionnaire schema, including the member fields of a
// members_repeater (those bind tokens too). Lower-cased to match the case-
// insensitive token comparison renderTemplate does.
function collectFieldIds(schema: QuestionnaireDoc): Set<string> {
  const ids = new Set<string>()
  const visit = (fields: ServiceField[] | undefined): void => {
    for (const f of fields ?? []) {
      if (f.id) ids.add(f.id.toLowerCase())
      if (f.memberFields) visit(f.memberFields)
    }
  }
  for (const s of schema.sections ?? []) visit(s.fields)
  return ids
}

// The result of validating a proposed questionnaire: the shape errors (from the
// SAME validateIntakeSchema the editor uses) PLUS the variable-contract gaps —
// template tokens with no matching field (would render [[token]]), and fields no
// template references (collected but never used in a document).
export interface ProposedQuestionnaireValidation {
  ok: boolean
  errors: string[]
  // Template tokens the questionnaire does NOT cover — a document would render these
  // as [[MISSING]]. An incomplete contract; surfaced on the card before approval.
  missingForTokens: string[]
  // Questionnaire fields no template token references — collected but unused. Not an
  // error (a form may capture more than the documents need), just surfaced.
  unusedFields: string[]
}

// Validate a proposed questionnaire the write path will persist: the FIXED-contract
// shape (validateIntakeSchema throws on the first problem — caught and surfaced as a
// single error), then the token-symmetry vs the service's templates. Takes the
// template tokens (already loaded for the context) to avoid a second read.
export function validateProposedQuestionnaire(
  schema: unknown,
  templateTokens: readonly string[],
): ProposedQuestionnaireValidation {
  const errors: string[] = []
  let validated: QuestionnaireDoc | null = null
  try {
    validated = validateIntakeSchema(schema)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  // Without a valid schema the token-symmetry can't be computed — report shape
  // errors only (every template token is "missing" until there's a valid form).
  if (!validated) {
    return {
      ok: false,
      errors,
      missingForTokens: [...templateTokens],
      unusedFields: [],
    }
  }
  const fieldIds = collectFieldIds(validated)
  const wanted = templateTokens.map((t) => t.toLowerCase())
  const missingForTokens = templateTokens.filter((t) => !fieldIds.has(t.toLowerCase()))
  const unusedFields = [...fieldIds].filter((id) => !wanted.includes(id))
  // A coverage gap is NOT a hard error — the attorney may approve a partial form and
  // fill the rest later — so `ok` reflects only the shape. The gaps ride on the card.
  return { ok: errors.length === 0, errors, missingForTokens, unusedFields }
}

// Reasoning summary the approve route carries from the chat turn that produced the
// proposal — the model's framing for WHY this questionnaire, plus an honest
// confidence the substrate clamps below 1.0 (an AI never claims certainty).
export interface QuestionnaireReasoning {
  conclusion: string
  evidence?: unknown[]
  alternatives?: unknown[]
  confidence?: number
  modelIdentity?: string
}

// Persist a reasoning_trace for an AI questionnaire write (mirrors
// serviceAuthoring.persistReasoningTrace): sourced to the Claude agent actor, with
// the confidence clamped strictly below 1.0. Returns the trace id.
async function persistReasoningTrace(
  ctx: ActionContext,
  serviceKey: string,
  schema: unknown,
  reasoning: QuestionnaireReasoning,
): Promise<string> {
  const id = randomUUID()
  const conclusion =
    reasoning.conclusion?.trim() || `Authored the intake questionnaire for ${serviceKey}.`
  const prompt = `Author the intake questionnaire for the service "${serviceKey}".`
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
        JSON.stringify({ serviceKey, schema, ...reasoning }),
      ],
    )
  })
  return id
}

// The AI write path (the live write happens ONLY on attorney approve). Validates the
// schema's shape, persists the reasoning_trace FIRST, then submits the questionnaire
// update AS THE AGENT ACTOR with intent 'adjustment' and the trace id. The write is
// legal.service.upsert with an intake_schema transitions_patch (the same versioned
// path updateQuestionnaire uses) — submitted here directly so the action carries the
// agent source + trace + intent, rather than going through updateQuestionnaire (which
// is the attorney's manual path with no trace).
export async function createQuestionnaireAI(
  ctx: ActionContext,
  serviceKey: string,
  schema: unknown,
  reasoning: QuestionnaireReasoning,
): Promise<QuestionnaireDoc> {
  // Validate the SHAPE before any write (incl. the trace) so an invalid proposal
  // leaves no trace row behind. Token-symmetry gaps are NOT blocking (the attorney
  // approved a partial form deliberately), so only the shape gates the write.
  const validated = validateIntakeSchema(schema)

  // The service must exist + the upsert requires its current display_name (the
  // questionnaire update preserves the rest of transitions).
  const current = await getQuestionnaire(ctx, serviceKey)
  if (current === null) {
    // getQuestionnaire returns null only when the SERVICE row is missing.
    const exists = await serviceExists(ctx, serviceKey)
    if (!exists) throw new Error(`Service not found: ${serviceKey}`)
  }

  // The write is AS THE AGENT, not the attorney — the trace, the action source, and
  // the configuration_change all attribute the authoring to the Claude agent actor,
  // exactly like createServiceAI / setServiceLifecycleAI.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const reasoningTraceId = await persistReasoningTrace(agentCtx, serviceKey, validated, reasoning)

  const displayName = await serviceDisplayName(agentCtx, serviceKey)
  await submitAction(agentCtx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    reasoningTraceId,
    payload: {
      service_key: serviceKey,
      display_name: displayName,
      transitions_patch: { intake_schema: validated },
    },
  })

  const saved = await getQuestionnaire(agentCtx, serviceKey)
  if (!saved) throw new Error(`Questionnaire not found after update: ${serviceKey}`)
  return saved
}

// Does an active service row exist for this key? (getQuestionnaire returns null both
// when the service is missing AND when it has no questionnaire — this disambiguates.)
async function serviceExists(ctx: ActionContext, serviceKey: string): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ kind_name: string }>(
      `SELECT kind_name FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows.length > 0
  })
}

// The service's current display_name — the upsert requires it (and preserves the
// rest of transitions). Throws when the service row is missing.
async function serviceDisplayName(ctx: ActionContext, serviceKey: string): Promise<string> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ display_name: string }>(
      `SELECT display_name FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const row = res.rows[0]
    if (!row) throw new Error(`Service not found: ${serviceKey}`)
    return row.display_name
  })
}

// Honest confidence: an AI authoring write must never claim certainty (ADR 0006).
// Same shape as serviceAuthoring.clampConfidence — capped at 0.99 (never 1.0), with
// a humble 0.6 fallback when no value is given (authoring firm configuration is
// higher-stakes than drafting a document).
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
