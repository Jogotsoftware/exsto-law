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
  listServicesIncludingInactive,
  resolveDocumentTemplateEsignConfig,
  type DocumentTemplateConfig,
  type DraftingConfig,
  type ServiceField,
  type QuestionnaireDoc,
} from './services.js'
import { extractRenderedTokens } from '../lib/templates/render.js'
import { isSystemToken } from './tokenClasses.js'
import {
  listStandaloneTemplates,
  parseTemplateEsignConfig,
  ESIGN_RECIPIENT_ROLES,
  type TemplateSignature,
  type TemplateEsignConfig,
} from '../queries/templates.js'
import { computeMarkerRoleDrift, MARKER_TYPE_PATTERN } from '../esign/fields.js'
import { createTemplate, updateTemplate } from './standaloneTemplates.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// the SAME id intakeAuthoring.ts / serviceAuthoring.ts source their writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// One of the service's existing document templates, summarized for the model.
export interface ExistingTemplateSummary {
  documentKind: string
  tokens: string[]
  // ESIGN-UNIFY-1 ES-3 (§6.3) — the kind's CURRENT e-sign config, if any, so a
  // revision proposal doesn't silently regress a previously authored
  // signable declaration.
  esignConfig: TemplateEsignConfig
}

// ESIGN-UNIFY-1 ES-3 (§6.3) — the e-sign vocabulary the build-wizard model
// needs to mark a document signable, assign roles, and emit role-tagged
// {{type:key}} blocks in the proposed body: the marker grammar it must use,
// the recipient-role vocabulary, and the bind kinds a role may resolve
// through at send/intake time.
export interface EsignAuthoringVocabulary {
  markerTypes: string[]
  recipientRoles: readonly string[]
  bindKinds: string[]
}

const ESIGN_VOCABULARY: EsignAuthoringVocabulary = {
  markerTypes: MARKER_TYPE_PATTERN.split('|'),
  recipientRoles: ESIGN_RECIPIENT_ROLES,
  bindKinds: [
    'matter_primary_contact',
    'attorney_of_record',
    'manual',
    'contact_role:<name> (a named contact relationship — resolves to nothing yet if undeclared elsewhere; prefer the first three)',
  ],
}

// One reusable QUESTION the firm already defines somewhere (Phase 7 — reuse-aware
// orphan handling). When a proposed template token matches a field id already used by
// ANOTHER service's questionnaire, the build should REUSE that question's definition
// instead of re-inventing it (or calling it "missing"). `services` lists which service
// keys already define this field id, so the model can point the attorney at the source.
export interface FirmQuestionSummary {
  fieldId: string
  // The service keys whose current questionnaire already defines this field id.
  services: string[]
}

// One template anywhere in the FIRM (Phase 5 — reuse), summarized so the model can
// ADAPT an existing body instead of re-drafting from scratch. `source` is either a
// service key (a body authored on that service's document_templates store) or
// 'library' (a standalone Templates-tab entry). The body is excerpted, not full —
// enough to recognize a match and decide to reuse; the model can request more by
// loading the library entry if needed.
export interface FirmTemplateSummary {
  // Where it lives: a service kind_name, or 'library' for a standalone template.
  source: string
  documentKind: string | null
  name: string
  tokens: string[]
  // A leading excerpt of the body so the model can judge fit (capped, see EXCERPT).
  bodyExcerpt: string
}

// The read-only context the chat tool hands the model to PROPOSE a template: the
// service's current questionnaire field ids (the tokens it may bind to), its
// existing templates, the FIRM-WIDE template library (to reuse/adapt — Phase 5),
// and the docKind registry across the firm's templates.
export interface TemplateAuthoringContext {
  serviceKey: string
  // The service's current questionnaire field ids — the model reuses these EXACT
  // tokens for its {{fill-ins}} so the template binds to real questions (no orphans).
  questionnaireFieldIds: string[]
  // Whether THIS service has authored a questionnaire yet (Phase 7). Drives flow-aware
  // framing: when false, a template token with no question is NOT an error — it will
  // BECOME a question in the next build step. The orphan warning is only real once a
  // questionnaire exists. (questionnaireFieldIds is empty in both the "no questionnaire
  // yet" and the "empty questionnaire" cases, so this flag disambiguates them.)
  hasQuestionnaire: boolean
  // Phase 7 — every questionnaire field id already defined across the FIRM's OTHER
  // services, so the model REUSES an existing question definition (company_name,
  // effective_date, principal_office_address, …) instead of re-inventing it. A
  // proposed token that matches one of these is reusable, NOT missing.
  firmFieldLibrary: FirmQuestionSummary[]
  // The service's existing document templates (by docKind) + their tokens, so the
  // model doesn't propose a duplicate or clash with an authored body.
  existingTemplates: ExistingTemplateSummary[]
  // Phase 5 — EVERY document template across the firm (the standalone library AND
  // each service's authored bodies), so the model can REUSE/ADAPT an existing one
  // (start from its content) instead of re-drafting a document it already has.
  templateLibrary: FirmTemplateSummary[]
  // Distinct document kinds across the FIRM's service templates — the docKind
  // registry a proposed template's kind should come from (or extend deliberately).
  docKinds: string[]
  // ESIGN-UNIFY-1 ES-3 (§6.3) — the vocabulary the model needs to propose a
  // signable document (marker grammar, recipient roles, bind kinds).
  esignVocabulary: EsignAuthoringVocabulary
}

// How much of a template body to carry into the reuse context. Enough to recognize
// a match and judge fit; the full body is reachable via the library entry on adapt.
const BODY_EXCERPT_CHARS = 600

function bodyExcerpt(body: string): string {
  const trimmed = body.trim()
  return trimmed.length > BODY_EXCERPT_CHARS
    ? `${trimmed.slice(0, BODY_EXCERPT_CHARS).trimEnd()} …[truncated]`
    : trimmed
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

// The FIRM-WIDE document-template library (Phase 5 — reuse). Composes the standalone
// Templates-tab library AND every service's authored document_templates into one flat
// list the model can search to ADAPT an existing body instead of re-drafting. Each
// entry carries its source (service key or 'library'), docKind, name, tokens, and a
// body excerpt. Read-only — composes existing list queries.
export async function loadFirmTemplateLibrary(ctx: ActionContext): Promise<FirmTemplateSummary[]> {
  const library: FirmTemplateSummary[] = []
  // 1) The standalone library (Templates tab) — document templates only (email
  //    templates are for notifications, not the wizard's document deliverables).
  for (const t of await listStandaloneTemplates(ctx)) {
    if (t.category !== 'document') continue
    library.push({
      source: 'library',
      documentKind: t.docKind,
      name: t.name,
      tokens: extractRenderedTokens(t.body),
      bodyExcerpt: bodyExcerpt(t.body),
    })
  }
  // 2) Every service's authored document templates (the bodies bound onto a service's
  //    document_templates store) — resolved in parallel to stay within budget.
  const services = await listServicesIncludingInactive(ctx)
  const perService = await Promise.all(
    services.map(async (s) => {
      const docs = await listServiceDocumentTemplates(ctx, s.serviceKey)
      return docs.map(
        (d): FirmTemplateSummary => ({
          source: s.serviceKey,
          documentKind: d.documentKind,
          // Service-bound bodies have no standalone name; the docKind is the label.
          name: d.documentKind,
          tokens: extractRenderedTokens(d.body),
          bodyExcerpt: bodyExcerpt(d.body),
        }),
      )
    }),
  )
  for (const docs of perService) library.push(...docs)
  return library
}

// The FIRM-WIDE question library (Phase 7 — reuse-aware orphans). Every questionnaire
// field id already defined by ANOTHER service's questionnaire, with the service keys
// that define it — so a proposed template token matching one of these is REUSABLE
// (the model should adopt that question's definition), not "missing". Excludes the
// service being authored (its own ids are questionnaireFieldIds). Read-only — composes
// the existing per-service questionnaire reads.
export async function loadFirmFieldLibrary(
  ctx: ActionContext,
  excludeServiceKey: string,
): Promise<FirmQuestionSummary[]> {
  const services = await listServicesIncludingInactive(ctx)
  // fieldId (lower-cased) → the set of service keys that define it.
  const byField = new Map<string, Set<string>>()
  const schemas = await Promise.all(
    services
      .filter((s) => s.serviceKey !== excludeServiceKey)
      .map(async (s) => ({ key: s.serviceKey, schema: await getQuestionnaire(ctx, s.serviceKey) })),
  )
  for (const { key, schema } of schemas) {
    for (const id of collectFieldIds(schema)) {
      const set = byField.get(id) ?? new Set<string>()
      set.add(key)
      byField.set(id, set)
    }
  }
  return [...byField.entries()]
    .map(([fieldId, set]) => ({ fieldId, services: [...set].sort() }))
    .sort((a, b) => a.fieldId.localeCompare(b.fieldId))
}

// Load everything the model needs to PROPOSE a document template for a service: the
// questionnaire field ids (the tokens it may bind to), whether this service has a
// questionnaire yet, the FIRM-WIDE question library (to reuse existing questions —
// Phase 7), the service's existing templates, the FIRM-WIDE template library (to
// reuse/adapt — Phase 5), and the docKind registry. Read-only.
export async function loadTemplateContext(
  ctx: ActionContext,
  serviceKey: string,
): Promise<TemplateAuthoringContext> {
  const schema = await getQuestionnaire(ctx, serviceKey)
  const questionnaireFieldIds = collectFieldIds(schema)
  const hasQuestionnaire = schema !== null
  const firmFieldLibrary = await loadFirmFieldLibrary(ctx, serviceKey)
  const docs = await listServiceDocumentTemplates(ctx, serviceKey)
  // The service's raw workflow row, read once, so per-kind esign lookups don't
  // each re-query — resolveDocumentTemplateEsignConfig is pure over it.
  const documentTemplatesConfig = await withActionContext(ctx, async (client) => {
    const res = await client.query<{
      transitions: { document_templates?: DocumentTemplateConfig }
    }>(
      `SELECT transitions FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0]?.transitions.document_templates
  })
  const existingTemplates = docs.map((d) => ({
    documentKind: d.documentKind,
    tokens: extractRenderedTokens(d.body),
    esignConfig: resolveDocumentTemplateEsignConfig(documentTemplatesConfig, d.documentKind),
  }))
  const templateLibrary = await loadFirmTemplateLibrary(ctx)
  // The firm-wide docKind registry: every kind any service has authored a template
  // for (the standalone library + this service's included). De-duped and sorted.
  const docKinds = [
    ...new Set(
      [
        ...existingTemplates.map((t) => t.documentKind),
        ...templateLibrary.map((t) => t.documentKind).filter((k): k is string => !!k),
      ].filter(Boolean),
    ),
  ].sort()
  return {
    serviceKey,
    questionnaireFieldIds,
    hasQuestionnaire,
    firmFieldLibrary,
    existingTemplates,
    templateLibrary,
    docKinds,
    esignVocabulary: ESIGN_VOCABULARY,
  }
}

// The result of validating a proposed template: the shape error (from the SAME
// validateDocumentTemplate the editor uses) PLUS the extracted {{tokens}} and the
// ORPHANS — tokens with no matching questionnaire field.id (would render [[token]]).
export interface ProposedTemplateValidation {
  ok: boolean
  errors: string[]
  // Every distinct {{token}} the body references (flat snake_case, first-seen order).
  tokens: string[]
  // Tokens with NO matching questionnaire field id on THIS service. Note: with the
  // documents→variables→questionnaire flow, this is normally EVERY token when the
  // questionnaire hasn't been built yet — those are NOT broken, they are the fields the
  // questionnaire will collect next. Only when a questionnaire already exists does an
  // orphan mean a genuinely missing question (renders [[MISSING]]). hasQuestionnaire
  // disambiguates; the card frames it accordingly.
  orphanTokens: string[]
  // Phase 7 — whether this service already has an authored questionnaire. When false,
  // orphanTokens are forward-looking ("these will become the questionnaire's
  // questions"); when true, an orphan is a real gap.
  hasQuestionnaire: boolean
  // Phase 7 — of the orphan tokens, those a field id already defines somewhere ELSE in
  // the firm. The build should REUSE those question definitions (don't re-invent, don't
  // call them missing). Subset of orphanTokens.
  reusableFromFirm: string[]
  // ESIGN-UNIFY-1 ES-3 (§6.3) — set only when an esignConfig was passed to
  // validate against. Unlike the token-orphan checks above (soft — forward-
  // looking), a drift failure here is a HARD error (folded into `errors`/`ok`):
  // a signable proposal that can't actually be signed is not a valid proposal.
  esign: { markerKeysWithoutRole: string[]; rolesWithoutSignMarker: string[] } | null
}

// Validate a proposed template body the write path will persist: non-empty text
// (validateDocumentTemplate throws — caught and surfaced as a single error), then
// extract its {{tokens}} via the real flat extractor and flag the orphans against
// the supplied questionnaire field ids. An orphan is NOT a hard error (the attorney
// may approve a body whose questions come later), so `ok` reflects only the shape.
//
// Phase 7: `hasQuestionnaire` controls the framing (forward-looking vs. broken) and
// `firmFieldIds` (every field id defined elsewhere in the firm) lets the card surface
// which orphans are REUSABLE existing questions rather than ones to invent.
export function validateProposedTemplate(
  body: unknown,
  fieldIds: readonly string[],
  opts?: {
    hasQuestionnaire?: boolean
    firmFieldIds?: readonly string[]
    // ESIGN-UNIFY-1 ES-3 (§6.3) — when provided AND signable, the proposal must
    // actually be signable: every role's marker keys ⊆ the body's marker keys
    // (no orphan markers), and every needs_to_sign role has ≥1 {{sign:key}}.
    esignConfig?: TemplateEsignConfig
  },
): ProposedTemplateValidation {
  const hasQuestionnaire = opts?.hasQuestionnaire ?? fieldIds.length > 0
  const firmKnown = new Set((opts?.firmFieldIds ?? []).map((f) => f.toLowerCase()))
  const errors: string[] = []
  let validated: string | null = null
  try {
    validated = validateDocumentTemplate(body)
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e))
  }
  if (validated === null) {
    return {
      ok: false,
      errors,
      tokens: [],
      orphanTokens: [],
      hasQuestionnaire,
      reusableFromFirm: [],
      esign: null,
    }
  }
  const tokens = extractRenderedTokens(validated)
  const known = new Set(fieldIds.map((f) => f.toLowerCase()))
  // System tokens (firm/attorney identity, dates, matter facts — tokenClasses.ts)
  // are platform-resolved: they never become questionnaire questions, so listing
  // them as orphans would misleadingly pitch them to the attorney as gaps.
  const orphanTokens = tokens.filter((t) => !known.has(t.toLowerCase()) && !isSystemToken(t))
  const reusableFromFirm = orphanTokens.filter((t) => firmKnown.has(t.toLowerCase()))

  let esign: ProposedTemplateValidation['esign'] = null
  if (opts?.esignConfig?.signable) {
    const drift = computeMarkerRoleDrift(validated, opts.esignConfig.roles)
    esign = drift
    if (drift.markerKeysWithoutRole.length > 0) {
      errors.push(
        `Marker key(s) with no matching e-sign role: ${drift.markerKeysWithoutRole.join(', ')} — every {{type:key}} marker's key must have a role row.`,
      )
    }
    if (drift.rolesWithoutSignMarker.length > 0) {
      errors.push(
        `Role(s) set to "needs to sign" with no {{sign:key}} marker in the body: ${drift.rolesWithoutSignMarker.join(', ')}.`,
      )
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    tokens,
    orphanTokens,
    hasQuestionnaire,
    reusableFromFirm,
    esign,
  }
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
  // BUILDER-CERT-1 (WP3) — the template's signability declaration, from the wizard's
  // "does the finished document get signed, and by whom?" ask (author-template Step 3).
  // Omitted/undefined = unsigned. Carried onto the FIRM-LIBRARY twin below, where the
  // e-sign composition validator reads it. Superseded by esignConfig below (ES-3);
  // kept for callers that haven't moved to the new shape.
  signature?: TemplateSignature
  // ESIGN-UNIFY-1 ES-3 (§6.3) — the full role/bind/order declaration the
  // build-wizard model may propose alongside role-tagged {{type:key}} blocks in
  // the body. Validated for marker↔role drift BEFORE any write (below); persisted
  // onto BOTH the service-bound document_templates.esign[docKind] AND the
  // firm-library twin, mirroring how `signature` rides both stores today.
  esignConfig?: TemplateEsignConfig
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

// A sound DEFAULT drafting prompt for an auto-route document kind, seeded when a
// template is authored (see createTemplateAI). It carries the three REQUIRED_DRAFTING_
// SLOTS the completeness gate checks ({{questionnaire_responses_json}},
// {{transcript_text}}, {{operating_agreement_template}}) and instructs the model to
// fill the firm's body template from the client's intake answers — so an ai_draft
// service produces real, answer-driven documents and a template_merge service simply
// satisfies the gate (its worker never reads this). The attorney can refine it later in
// the service editor.
function defaultDraftingPrompt(docKind: string): string {
  const label = docKind.replace(/_/g, ' ')
  return [
    `You are drafting a ${label} under North Carolina law (and applicable U.S. federal law). Complete the firm's template below using the client's intake answers; fill every field the answers provide and follow the template's structure exactly. Where a required value is genuinely missing, LEAVE ITS {{token}} IN PLACE UNCHANGED — never invent a value and never write bracketed filler like "[X — TO INSERT]"; the platform renders unresolved tokens as visible markers and resolves them at review. Never write draft banners, watermarks, or review notices into the document — review state is rendered by the platform from the document's status, not written into its text. Output the final document only — no commentary. This is the BASE guidance: if the attorney adds specific instructions for this draft (appended below these inputs), FOLLOW THEM — attorney instructions always take precedence over this base prompt wherever they conflict.`,
    ``,
    `The client's intake answers (use these to fill the document):`,
    `{{questionnaire_responses_json}}`,
    ``,
    `Consultation notes, if any (additional context):`,
    `{{transcript_text}}`,
    ``,
    `The document template to complete:`,
    `{{operating_agreement_template}}`,
  ].join('\n')
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
): Promise<{ serviceKey: string; documentKind: string; templateEntityId: string }> {
  const docKind = (input.docKind ?? '').trim()
  if (!docKind) throw new Error('A document kind is required to author a template.')
  // Validate the body BEFORE any write (incl. the trace) so an invalid proposal
  // leaves no trace row behind.
  const body = validateDocumentTemplate(input.body)
  // Validate the signature declaration BEFORE any write too — the twin write (below)
  // is a separate action AFTER the service-bound write commits, so a malformed
  // declaration must fail HERE, not half-way through (review finding: the HTTP
  // approve route forwards it unvalidated).
  if (input.signature?.required === true && (input.signature.signer_roles ?? []).length === 0) {
    throw new Error(
      'signature.required is true but signer_roles is empty — declare who signs (client, attorney, witness, notary).',
    )
  }
  // ESIGN-UNIFY-1 ES-3 (§6.3) — validate the esign declaration BEFORE any write,
  // same discipline as the legacy signature check above: shape (via the
  // defensive parser + the "signable needs a signer" invariant) AND marker↔role
  // drift against the body the AI actually proposed. A signable proposal that
  // has nothing for its signer to sign is not a valid proposal.
  const esignConfig = input.esignConfig ? parseTemplateEsignConfig(input.esignConfig) : null
  if (esignConfig?.signable) {
    if (!esignConfig.roles.some((r) => r.recipientRole === 'needs_to_sign')) {
      throw new Error(
        'esignConfig.signable is true but no role is set to "needs_to_sign" — declare at least one signer.',
      )
    }
    const drift = computeMarkerRoleDrift(body, esignConfig.roles)
    if (drift.markerKeysWithoutRole.length > 0 || drift.rolesWithoutSignMarker.length > 0) {
      const parts: string[] = []
      if (drift.markerKeysWithoutRole.length > 0) {
        parts.push(`marker key(s) with no matching role: ${drift.markerKeysWithoutRole.join(', ')}`)
      }
      if (drift.rolesWithoutSignMarker.length > 0) {
        parts.push(
          `role(s) needing a signature with no {{sign:key}} marker in the body: ${drift.rolesWithoutSignMarker.join(', ')}`,
        )
      }
      throw new Error(`esignConfig doesn't match the body's markers — ${parts.join('; ')}.`)
    }
  }

  // Read the current row to MERGE into its document_templates (so other kinds'
  // bodies survive), its `documents` list (the doc kinds the service produces — a
  // template MUST register its kind there or an auto-route service never has a
  // document to draft and fails completeness/Enable), its route + drafting config
  // (to seed the per-kind drafting prompt completeness needs), and the display_name
  // the upsert requires.
  const row = await withActionContext(ctx, async (client) => {
    const res = await client.query<{
      display_name: string
      transitions: {
        document_templates?: DocumentTemplateConfig
        documents?: string[]
        route?: string
        drafting?: DraftingConfig
      }
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
    // Carry the esign map through unchanged when this proposal didn't touch it
    // (transitions_patch replaces document_templates wholesale — see the same
    // note in updateDocumentTemplate); write the new declaration when it did.
    ...(esignConfig
      ? { esign: { ...(existing.esign ?? {}), [docKind]: esignConfig } }
      : existing.esign
        ? { esign: existing.esign }
        : {}),
  }
  // Register the kind in the service's `documents` list (idempotent) so an auto-route
  // service has a document to draft — without this it fails completeness ("auto-route
  // service needs at least one document to draft") and can never be Enabled.
  const existingDocs = Array.isArray(row.transitions.documents) ? row.transitions.documents : []
  const documents = existingDocs.includes(docKind) ? existingDocs : [...existingDocs, docKind]

  // SEED THE DRAFTING PROMPT (the bug fix): an auto-route service's completeness gate
  // requires a per-kind drafting prompt in transitions.drafting.prompts[kind] (with the
  // required slots) — but the wizard has no separate "propose drafting prompt" tool, so
  // the model used to misfile the prompt as a second document template (a phantom
  // "<kind>_drafting_prompt" doc) and the service could never enable. Here, when we
  // author a document body for an auto service that has NO prompt for this kind yet, we
  // seed a sound default prompt in the RIGHT place so the service is actually
  // enableable; the attorney can refine it in the editor. (template_merge never reads
  // it; it just satisfies the gate. Manual-route services need no prompt.)
  const route = row.transitions.route === 'auto' ? 'auto' : 'manual'
  const existingDrafting: DraftingConfig = row.transitions.drafting ?? {}
  const hasPrompt = !!(existingDrafting.prompts ?? {})[docKind]?.trim?.()
  const draftingPatch: DraftingConfig | undefined =
    route === 'auto' && !hasPrompt
      ? {
          prompt_version:
            (typeof existingDrafting.prompt_version === 'number'
              ? existingDrafting.prompt_version
              : 0) + 1,
          prompts: {
            ...(existingDrafting.prompts ?? {}),
            [docKind]: defaultDraftingPrompt(docKind),
          },
        }
      : undefined

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
      transitions_patch: {
        document_templates: merged,
        documents,
        ...(draftingPatch ? { drafting: draftingPatch } : {}),
      },
    },
  })

  const saved = await getDocumentTemplate(agentCtx, serviceKey, docKind)
  if (!saved) throw new Error(`Document template not found after write: ${serviceKey}`)

  // BUILDER-CERT-1 (WP3) — the FIRM-LIBRARY TWIN. The service-bound copy above is
  // what auto-route drafting + completeness read; but the drafting CAPABILITY
  // (invoke_capability{document_generation}) binds a template by EXACT firm-library
  // entity id, and the e-sign validator reads signability off that entity — neither
  // can see a service-bound body. Without this write, a wizard-authored template is
  // invisible to get_workflow_context's availableTemplates and no drafting/e-sign
  // step can ever bind it (the exact wall the certification drive hit).
  //
  // Upsert key: docKind ALONE — the same key the service-bound store uses and the
  // same association the docKind→service autobind model rests on. Keying by
  // (docKind, name) duplicated the twin whenever a revision arrived under a new
  // display name, stranding any workflow step bound to the old twin's entity id on
  // stale content (review finding). Renames update the SAME entity in place; when
  // several twins already share the docKind (legacy data), the exact-name match
  // wins, else the newest.
  const library = (await listStandaloneTemplates(agentCtx)).filter(
    (t) => t.category === 'document' && t.docKind === docKind,
  )
  const twin =
    library.find((t) => t.name === input.name) ??
    [...library].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
  let templateEntityId: string
  if (twin) {
    await updateTemplate(agentCtx, {
      templateEntityId: twin.templateEntityId,
      name: input.name,
      body,
      ...(input.signature != null ? { signature: input.signature } : {}),
      ...(esignConfig != null ? { esignConfig } : {}),
    })
    templateEntityId = twin.templateEntityId
  } else {
    const created = await createTemplate(agentCtx, {
      name: input.name,
      category: 'document',
      body,
      docKind,
      ...(input.signature != null ? { signature: input.signature } : {}),
      ...(esignConfig != null ? { esignConfig } : {}),
    })
    templateEntityId = created.templateEntityId
  }

  return { serviceKey, documentKind: docKind, templateEntityId }
}

// Honest confidence: an AI authoring write must never claim certainty (ADR 0006).
// Capped at 0.99 (never 1.0), with a humble 0.6 fallback when no value is given.
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
