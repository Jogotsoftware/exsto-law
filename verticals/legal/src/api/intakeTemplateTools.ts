// Intake/template-authoring chat tools (Build-Wizard Phase 2+3) — four ClientTools
// the attorney's Claude turn registers ALONGSIDE the workflow/service authoring
// pairs, mirroring workflowAuthoringTools.ts exactly:
//   • buildQuestionnaireContextTool — READ-ONLY: the model calls it to learn the
//     closed field-type vocabulary, the service's current intake schema, the
//     {{tokens}} its document templates reference (the contract to cover), and the
//     firm's questionnaire library (to reuse). It composes a questionnaire ONLY from
//     these field types.
//   • buildProposeQuestionnaireTool — CAPTURE-ONLY: the model calls it with a
//     proposed intake schema. It is validated (shape via validateIntakeSchema +
//     token-symmetry vs the templates) and CAPTURED into a per-turn array the caller
//     surfaces as an approval card. The ack + the card surface missingForTokens (the
//     template tokens the form does NOT yet collect) so the attorney sees coverage
//     before approving. It writes NOTHING.
//   • buildTemplateContextTool — READ-ONLY: the model calls it to learn the service's
//     questionnaire field ids (the tokens it may bind to), its existing templates,
//     and the docKind registry. It binds its {{tokens}} to those field ids.
//   • buildProposeTemplateTool — CAPTURE-ONLY: the model calls it with a proposed
//     body. It is validated (non-empty + {{token}} extraction) and CAPTURED; the ack
//     + the card surface orphanTokens (tokens with no matching question) so the
//     attorney sees the broken half of the contract before approving. It writes
//     NOTHING.
//
// The variable contract is the point: a questionnaire that doesn't cover a template's
// tokens is INCOMPLETE (missingForTokens); a template token with no question is an
// ORPHAN (orphanTokens → renders [[MISSING]]). Both validators surface these so the
// attorney never approves a broken contract.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  loadQuestionnaireContext,
  loadServiceTemplateTokens,
  validateProposedQuestionnaire,
} from './intakeAuthoring.js'
import {
  loadTemplateContext,
  loadFirmFieldLibrary,
  validateProposedTemplate,
} from './templateAuthoring.js'
import {
  collectQuestionnaireFieldIds,
  getQuestionnaire,
  isPromptArtifactDocKind,
} from './services.js'

// A questionnaire proposal captured this turn — the proposed schema plus the model's
// reasoning and the token-symmetry coverage. The chat surfaces it as an inline card;
// the attorney approves it, which posts the approve route (the only live write).
export interface QuestionnaireProposal {
  serviceKey: string
  schema: unknown
  summary: string
  confidence: number
  // The variable contract, computed at capture so the card needs no recompute:
  // template tokens the form does NOT collect (incomplete) and fields no template
  // uses (collected-but-unused). missingForTokens is the one the attorney must see.
  missingForTokens: string[]
  unusedFields: string[]
}

// A template proposal captured this turn — the proposed body + docKind + reasoning,
// plus the extracted tokens and orphans. Surfaced as an inline approval card.
export interface TemplateProposal {
  serviceKey: string
  name: string
  body: string
  docKind: string
  summary: string
  confidence: number
  // The {{tokens}} the body references, and the orphans (no matching question on THIS
  // service). With the documents→variables→questionnaire flow, orphans before the
  // questionnaire exists are NOT broken — they're the fields the questionnaire will
  // collect next; hasQuestionnaire tells the card which framing to use.
  tokens: string[]
  orphanTokens: string[]
  // Phase 7 — whether this service already has a questionnaire (drives the card's
  // framing: forward-looking "will become questions" vs. red "missing → [[MISSING]]").
  hasQuestionnaire: boolean
  // Phase 7 — orphan tokens that already exist as questions ELSEWHERE in the firm; the
  // questionnaire step should REUSE those definitions rather than re-invent them.
  reusableFromFirm: string[]
}

// ─── Questionnaire context + propose ────────────────────────────────────────

const QUESTIONNAIRE_CONTEXT_TOOL_DEF = {
  name: 'get_questionnaire_context',
  description:
    "Get everything needed to PROPOSE the intake QUESTIONNAIRE for an existing service — AND to REUSE one the firm already has: `library` is the firm's saved questionnaires WITH their fields (id/label/type), and `questionLibrary` is the distinct reusable questions across all of them. SEARCH these FIRST: if a saved questionnaire is a close match, REUSE/ADAPT it field-for-field rather than authoring a new form; for individual questions, pull from `questionLibrary` (matching id/label/type) instead of re-writing them. Also returns the closed set of field types you may use, the service's current questionnaire (null if none), and the {{tokens}} its document templates reference (your questionnaire SHOULD collect a field for each so the documents merge with no [[MISSING]] gaps). Compose a questionnaire ONLY from those field types, and prefer field ids that MATCH the template tokens so the form covers the documents. Call this FIRST whenever the attorney asks you to build, add to, or change a service's intake form.",
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description:
          "The kind_name of the EXISTING service whose questionnaire you are authoring (e.g. 'nc_single_member_llc_formation').",
      },
    },
    required: ['service_key'],
    additionalProperties: false,
  },
}

// Read-only context tool. Returns the field-type vocab + current schema + template
// tokens + library as JSON for the model. No capture, no write.
export function buildQuestionnaireContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: QUESTIONNAIRE_CONTEXT_TOOL_DEF,
    name: 'get_questionnaire_context',
    run: async (raw) => {
      const args = (raw ?? {}) as { service_key?: string }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'A service_key is required to load the questionnaire context.'
      const context = await loadQuestionnaireContext(ctx, serviceKey)
      return JSON.stringify(context)
    },
  }
}

const PROPOSE_QUESTIONNAIRE_TOOL_DEF = {
  name: 'propose_questionnaire',
  description:
    'Propose the intake QUESTIONNAIRE (the sections + fields) for an existing service for the attorney to review and APPROVE. This does NOT save anything — it captures the proposal so the attorney sees it as an approval card; the questionnaire is written only when they approve. Use ONLY field types from get_questionnaire_context, and prefer field ids that match the template {{tokens}} so the documents merge cleanly. Call this ONLY when you have a complete, valid schema; put the schema ONLY in this tool call, not in your chat reply.',
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description: 'The kind_name of the service whose questionnaire this is.',
      },
      schema: {
        type: 'object',
        description:
          'The intake schema: { title?, sections: [{ id, title, fields: [{ id, label, type, required?, options?, memberFields? }] }] }. Field ids should match the template tokens you want to cover. Use ONLY the field types from get_questionnaire_context.',
      },
      summary: {
        type: 'string',
        description:
          'A one-paragraph plain-language summary of WHY this questionnaire and what it captures. Shown to the attorney and recorded as the reasoning trace on approve.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: ['service_key', 'schema'],
    additionalProperties: false,
  },
}

// Build the propose_questionnaire tool for this turn. Its run() validates the schema
// (shape + token-symmetry vs the service's templates) and, on a valid SHAPE, CAPTURES
// it (with the coverage gaps) into `captured` — it never writes. On a shape failure
// it returns the errors so the model can fix and re-propose. The ack surfaces
// missingForTokens (the template tokens not yet collected) so the model can mention
// coverage.
export function buildProposeQuestionnaireTool(
  ctx: ActionContext,
  captured: QuestionnaireProposal[],
): ClientTool {
  return {
    definition: PROPOSE_QUESTIONNAIRE_TOOL_DEF,
    name: 'propose_questionnaire',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        service_key?: string
        schema?: unknown
        summary?: string
        confidence?: number
      }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) {
        return 'A service_key is required to propose a questionnaire; nothing was captured.'
      }
      if (!args.schema || typeof args.schema !== 'object') {
        return 'A schema object is required to propose a questionnaire; nothing was captured.'
      }
      // The template tokens are the contract target — one read, shared with the
      // validation (and carried onto the card as the coverage line).
      const { tokens: templateTokens } = await loadServiceTemplateTokens(ctx, serviceKey)
      const validation = validateProposedQuestionnaire(args.schema, templateTokens)
      if (!validation.ok) {
        return `The proposed questionnaire is not valid and was NOT captured. Fix these and call propose_questionnaire AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button): ${validation.errors.join('; ')}`
      }
      // HARD RULE (the variable contract): the questionnaire MUST collect EVERY value the
      // document templates reference. If a template uses a token, the form has to capture
      // it — add a NEW question, or REUSE an existing firm question by giving the field
      // that token's id. Refuse to capture a questionnaire that leaves any token
      // uncovered, so the build never hands the attorney a form with [[MISSING]] gaps to
      // patch by hand. (No templates yet ⇒ no tokens ⇒ nothing to enforce.)
      if (validation.missingForTokens.length > 0) {
        return `The questionnaire does NOT yet collect every value the document templates need, so it was NOT captured. The contract is: every template token must have a matching question. Add a field for EACH of these tokens — the field id must EXACTLY equal the token (reuse an existing firm question's definition when one matches by id; otherwise add a new question) — then call propose_questionnaire again: ${validation.missingForTokens.join(', ')}. Do not propose a questionnaire that leaves any of these uncovered.`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      captured.push({
        serviceKey,
        schema: args.schema,
        summary:
          (args.summary ?? '').trim() || `Proposed an intake questionnaire for ${serviceKey}.`,
        confidence,
        missingForTokens: validation.missingForTokens,
        unusedFields: validation.unusedFields,
      })
      const coverage = templateTokens.length
        ? validation.missingForTokens.length
          ? `It covers ${templateTokens.length - validation.missingForTokens.length}/${templateTokens.length} template tokens — these are NOT yet collected: ${validation.missingForTokens.join(', ')}.`
          : `It covers all ${templateTokens.length} template tokens.`
        : 'The service has no document templates yet, so there are no tokens to cover.'
      return `The proposed questionnaire is shown to the attorney as an approval card; it is NOT saved until they approve. ${coverage} The card renders BELOW your reply (never say "above"). If you already wrote a framing sentence this turn, reply with an EMPTY message — otherwise ONE short sentence (mention the coverage if any tokens are uncovered); NEVER repeat the fields in prose.`
    },
  }
}

// ─── Template context + propose ─────────────────────────────────────────────

const TEMPLATE_CONTEXT_TOOL_DEF = {
  name: 'get_template_context',
  description:
    "Get everything needed to PROPOSE a document TEMPLATE for an existing service — AND to REUSE one the firm already has instead of re-drafting: `templateLibrary` is EVERY document template across the firm (the standalone Templates library AND each service's authored bodies), each with its source, document kind, name, tokens, and a body excerpt. SEARCH `templateLibrary` FIRST: if a close match exists, ADAPT it (start from its content) rather than writing a new body from scratch. Also returns the service's current questionnaire field ids (use these EXACT ids as your {{tokens}} so the document merges with no [[MISSING]] gaps), the service's existing document templates, and the document-kind registry. Every {{token}} you put in the body should match one of those field ids; a token with no matching field is an ORPHAN that renders [[MISSING]]. Tokens are flat snake_case — NEVER dotted paths. Call this FIRST whenever the attorney asks you to draft, add, or change a service's document template.",
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description:
          "The kind_name of the EXISTING service whose template you are authoring (e.g. 'nc_single_member_llc_formation').",
      },
    },
    required: ['service_key'],
    additionalProperties: false,
  },
}

// Read-only context tool. Returns the questionnaire field ids + existing templates +
// docKind registry as JSON for the model. No capture, no write.
export function buildTemplateContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: TEMPLATE_CONTEXT_TOOL_DEF,
    name: 'get_template_context',
    run: async (raw) => {
      const args = (raw ?? {}) as { service_key?: string }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'A service_key is required to load the template context.'
      const context = await loadTemplateContext(ctx, serviceKey)
      return JSON.stringify(context)
    },
  }
}

const PROPOSE_TEMPLATE_TOOL_DEF = {
  name: 'propose_template',
  description:
    'Propose a document TEMPLATE (a markdown body with {{tokens}}) for an existing service for the attorney to review and APPROVE. This does NOT save anything — it captures the proposal so the attorney sees it as an approval card; the template is written only when they approve. Bind every {{token}} to a questionnaire field id from get_template_context; tokens are flat snake_case (NEVER dotted paths). Call this ONLY when you have a complete body; put the body ONLY in this tool call, not in your chat reply.',
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description: 'The kind_name of the service this template belongs to.',
      },
      name: {
        type: 'string',
        description: "An attorney-facing template name, e.g. 'Engagement Letter'.",
      },
      body: {
        type: 'string',
        description:
          'The COMPLETE document body in markdown, with {{tokens}} (flat snake_case) wherever a value is filled per matter. Bind tokens to questionnaire field ids.',
      },
      doc_kind: {
        type: 'string',
        description:
          "The document kind this template produces — the actual DELIVERABLE the client receives, snake_case (e.g. 'engagement_letter', 'operating_agreement', 'mutual_nda'). This is the binding key in the service. It must NEVER be a prompt or instruction: do NOT create a separate '<kind>_drafting_prompt' (or similar) document — the AI drafting prompt is handled automatically when you author the body, so author ONLY the real document(s) the client gets.",
      },
      summary: {
        type: 'string',
        description:
          'A one-paragraph plain-language summary of WHY this template. Shown to the attorney and recorded as the reasoning trace on approve.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: ['service_key', 'name', 'body', 'doc_kind'],
    additionalProperties: false,
  },
}

// Build the propose_template tool for this turn. Its run() validates the body
// (non-empty + token extraction against the service's questionnaire field ids) and,
// on a valid SHAPE, CAPTURES it (with the orphan tokens) into `captured` — it never
// writes. On a shape failure it returns the error. The ack surfaces orphanTokens
// (tokens with no matching question) so the model can flag the gap.
export function buildProposeTemplateTool(
  ctx: ActionContext,
  captured: TemplateProposal[],
): ClientTool {
  return {
    definition: PROPOSE_TEMPLATE_TOOL_DEF,
    name: 'propose_template',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        service_key?: string
        name?: string
        body?: string
        doc_kind?: string
        summary?: string
        confidence?: number
      }
      const serviceKey = (args.service_key ?? '').trim()
      const docKind = (args.doc_kind ?? '').trim()
      const name = (args.name ?? '').trim()
      if (!serviceKey)
        return 'A service_key is required to propose a template; nothing was captured.'
      if (!docKind) return 'A doc_kind is required to propose a template; nothing was captured.'
      // A doc_kind must be a real deliverable, never a prompt artifact. Authoring a
      // "<kind>_drafting_prompt" document pollutes the service (it would then demand
      // its own drafting prompt and block enablement). The AI drafting prompt is set
      // up automatically from the body, so reject these outright.
      if (isPromptArtifactDocKind(docKind)) {
        return (
          `"${docKind}" is not a real document — a doc_kind must be the actual deliverable ` +
          `the client receives (e.g. mutual_nda), never a "<kind>_drafting_prompt". The AI ` +
          `drafting prompt is set up automatically when you author the document body, so ` +
          `re-call propose_template with the real doc_kind and the document itself.`
        )
      }
      // The questionnaire field ids are the contract target — one read, shared with
      // the validation (and used to flag orphan tokens on the card). Whether this
      // service has a questionnaire YET (flow-aware framing) + the firm-wide field
      // library (reuse-aware orphans) are read in parallel (Phase 7).
      const [fieldIds, schema, firmFields] = await Promise.all([
        collectQuestionnaireFieldIds(ctx, serviceKey),
        getQuestionnaire(ctx, serviceKey),
        loadFirmFieldLibrary(ctx, serviceKey),
      ])
      const hasQuestionnaire = schema !== null
      const firmFieldIds = firmFields.map((f) => f.fieldId)
      const validation = validateProposedTemplate(args.body, fieldIds, {
        hasQuestionnaire,
        firmFieldIds,
      })
      if (!validation.ok) {
        return `The proposed template is not valid and was NOT captured. Fix these and call propose_template AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button): ${validation.errors.join('; ')}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      captured.push({
        serviceKey,
        name: name || docKind,
        body: (args.body ?? '').trim(),
        docKind,
        summary:
          (args.summary ?? '').trim() || `Proposed a "${docKind}" template for ${serviceKey}.`,
        confidence,
        tokens: validation.tokens,
        orphanTokens: validation.orphanTokens,
        hasQuestionnaire,
        reusableFromFirm: validation.reusableFromFirm,
      })
      // Flow-aware ack (Phase 7): before a questionnaire exists, orphan tokens are NOT
      // broken — they are the fields the questionnaire step will collect next, so frame
      // them forward-looking. Only flag a real [[MISSING]] gap once a questionnaire
      // exists. Either way, surface which tokens ALREADY exist firm-wide to reuse.
      const reuseNote = validation.reusableFromFirm.length
        ? ` These already exist as questions on other services — REUSE those definitions when you build the questionnaire: ${validation.reusableFromFirm.join(', ')}.`
        : ''
      let tokenNote: string
      if (validation.orphanTokens.length === 0) {
        tokenNote = 'Every token maps to a question — the contract is complete.'
      } else if (!hasQuestionnaire) {
        tokenNote = `These ${validation.orphanTokens.length} field(s) will become the questionnaire's questions in the NEXT step (this is expected — the questionnaire is built from the template's tokens): ${validation.orphanTokens.join(', ')}.${reuseNote}`
      } else {
        tokenNote = `WARNING: these tokens have NO matching question and would render [[MISSING]]: ${validation.orphanTokens.join(', ')}. Add those questions to the questionnaire.${reuseNote}`
      }
      return `The proposed template "${name || docKind}" is shown to the attorney as an approval card; it is NOT saved until they approve. ${tokenNote} The card renders BELOW your reply (never say "above"). If you already wrote a framing sentence this turn, reply with an EMPTY message — otherwise ONE short sentence; NEVER repeat the body in prose.`
    },
  }
}
