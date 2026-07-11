// Service-authoring chat tools (Build-Wizard Phase 1) — two ClientTools the
// attorney's Claude turn registers ALONGSIDE the workflow-authoring pair, mirroring
// workflowAuthoringTools.ts exactly one layer up:
//   • buildServiceContextTool — READ-ONLY: the model calls it to learn the existing
//     service keys (for uniqueness), the closed route + generation_mode
//     vocabularies, and the firm's bundled docKind registry. It composes a proposal
//     ONLY from these; it never invents a route or generation mode.
//   • buildProposeServiceTool — CAPTURE-ONLY: the model calls it with a proposed
//     service shell. It is validated (non-empty name + closed vocab + unique derived
//     key) and CAPTURED into a per-turn proposals array the caller surfaces as an
//     inline approval card. It writes NOTHING — the live version-1 row is created
//     only when the attorney approves. The ack tells the model not to repeat the
//     proposal in prose.
//
// The input_schema constrains route + generation_mode to the closed vocabularies, so
// the guardrail is on the tool surface as well as in the validator.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import {
  loadServiceAuthoringContext,
  validateProposedService,
  slugifyServiceKey,
  SERVICE_ROUTES,
  SERVICE_GENERATION_MODES,
  type ServiceProposal,
} from './serviceAuthoring.js'
import { serviceCompleteness, type WorkflowRoute } from './services.js'
import type { GenerationMode } from './generateDraft.js'

const SERVICE_CONTEXT_TOOL_DEF = {
  name: 'get_service_context',
  description:
    "Get everything needed to PROPOSE a new SERVICE for this firm — AND to check whether one already exists you should EDIT instead: `existingServices` is the firm's current services, each with its key, display name, description, and whether it already has a workflow / questionnaire / how many document templates (and which kinds). SEARCH `existingServices` FIRST: if a service like the one the attorney is asking for already exists, propose EDITING that one (point them to its key) rather than creating a duplicate — only propose a brand-new service when nothing close exists. Also returns `serviceKeys` (so a new service's key is unique), the closed set of workflow routes ('manual' or 'auto'), the closed set of generation modes ('template_merge' or 'ai_draft'), and the firm's bundled document-kind registry. Compose a service ONLY from these — never invent a route or a generation mode. Call this FIRST whenever the attorney asks you to create, set up, or add a new service offering.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

// Read-only context tool. Returns the existing keys + vocabularies + docKind
// registry as JSON for the model. No capture, no write.
export function buildServiceContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: SERVICE_CONTEXT_TOOL_DEF,
    name: 'get_service_context',
    run: async () => {
      const context = await loadServiceAuthoringContext(ctx)
      return JSON.stringify(context)
    },
  }
}

const PROPOSE_SERVICE_TOOL_DEF = {
  name: 'propose_service',
  description:
    'Propose a NEW service offering (an empty shell — name, description, route, generation mode) for the attorney to review and APPROVE. This does NOT save anything — it captures the proposal so the attorney sees it as an approval card; the service is created (as a disabled version 1) only when they approve. Use ONLY a route and generation_mode from get_service_context, and a display_name whose derived key is not already taken. Call this ONLY when you have a complete, valid proposal; put the proposal ONLY in this tool call, not in your chat reply.',
  input_schema: {
    type: 'object',
    properties: {
      display_name: {
        type: 'string',
        description: "The attorney-facing service name, e.g. 'NC Single-Member LLC Formation'.",
      },
      description: {
        type: 'string',
        description:
          "The ATTORNEY-FACING description — jurisdiction-specific and process-detailed is CORRECT here (e.g. 'Reviews NC residential leases against Chapter 42; returns annotated lease + client letter.'). Clients never see this field (they see client_description); still never marketing fluff.",
      },
      client_display_name: {
        type: 'string',
        description:
          "The CLIENT-FACING service name shown on the public intake tiles. OUTCOME-ONLY, in words a client would actually say: 'Last Will & Testament', NOT 'NC Will Drafting'. NEVER include a jurisdiction/state (no 'NC', 'Georgia', …), never legal-industry jargon, never process words. Max 70 characters. REQUIRED.",
      },
      client_description: {
        type: 'string',
        description:
          "The CLIENT-FACING one-liner under the tile name: WHAT THE CLIENT RECEIVES, max 70 characters (hard server-side cap). Outcome only — e.g. 'A will that protects your family and your wishes'. NEVER the process, scope, jurisdiction, or how it is produced. REQUIRED.",
      },
      route: {
        type: 'string',
        enum: SERVICE_ROUTES as unknown as string[],
        description:
          "How the matter is worked: 'manual' (the attorney drives it) or 'auto' (documents draft from intake). REQUIRED and NEVER assumed — DERIVE it from the attorney's process walkthrough, then CONFIRM it in plain attorney language via ask_build_question (e.g. \"Sounds like the documents should draft themselves from the client's answers — right?\"). Never say the word 'route' to the attorney; the translation to this field happens silently here.",
      },
      generation_mode: {
        type: 'string',
        enum: SERVICE_GENERATION_MODES as unknown as string[],
        description:
          "How documents are produced: 'template_merge' (deterministic merge, no AI) or 'ai_draft' (AI drafting). REQUIRED and NEVER assumed — DERIVE it from the walkthrough, then CONFIRM in plain attorney language via ask_build_question (e.g. \"Should the documents fill a fixed template word-for-word, or should AI adapt the wording to each client?\"). Never say 'generation mode' to the attorney; translate silently here.",
      },
      appointment_required: {
        type: 'boolean',
        description:
          "Does booking this service START with a consultation appointment? true = the client picks a time slot when they book (services that open with a meeting); false = intake-only — the work starts straight from the client's answers/upload with no slot (document-review services, most pure document-production). REQUIRED and NEVER assumed — DERIVE it from the walkthrough (a process that opens with a consult → true; \"they upload the lease and I review it\" → false) and confirm in plain language only when genuinely ambiguous. Never say 'appointment_required' to the attorney.",
      },
      summary: {
        type: 'string',
        description:
          'ONE crisp sentence of what the service IS and DOES, written for the attorney (e.g. "Reviews a client\'s healthcare employment contract and returns attorney notes plus a ready-to-send employer email."). NEVER process narration — "no existing service covers this, so it is new", "jurisdiction assumed…", or route/mode restatements belong in your private reasoning, never in text the attorney reads. Recorded as the reasoning trace on approve.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: [
      'display_name',
      'client_display_name',
      'client_description',
      'route',
      'generation_mode',
      'appointment_required',
    ],
    additionalProperties: false,
  },
}

// US state names + standalone UPPERCASE two-letter codes — the client tile copy
// doctrine forbids jurisdiction entirely (Phase 2). Case-insensitive on the full
// names; the two-letter codes only match as uppercase standalone words so 'in',
// 'me', 'or' in normal prose never false-positive.
const STATE_NAME_RE =
  /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i
const STATE_CODE_RE =
  /\b(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)\b/

// Capture-time doctrine check for the client tile copy: no jurisdiction, hard
// 70-char budget. Returns the rejection message (model rewrites and re-proposes)
// or null when clean. The upsert handler's capClientCopy is the last-resort
// truncate-and-flag; THIS check exists so the copy gets rewritten well, not chopped.
export function clientCopyViolation(field: string, value: string): string | null {
  if (value.length > 70) {
    return `${field} is ${value.length} characters — the hard cap is 70 (it renders on a small tile). Shorten it and call propose_service again.`
  }
  const state = value.match(STATE_NAME_RE) ?? value.match(STATE_CODE_RE)
  if (state) {
    return `${field} must NEVER name a jurisdiction ("${state[0]}") — client tile copy is outcome-only ('Last Will & Testament', not 'NC Will Drafting'). Jurisdiction belongs in the attorney-facing display_name/description. Rewrite and call propose_service again.`
  }
  return null
}

// Build the propose_service tool for this turn. Its run() validates the shell (the
// SAME checks the write path applies) and, on success, CAPTURES it into `captured`
// (read back by the caller to surface the approval card) — it never writes. On a
// validation failure it returns the errors so the model can fix and re-propose.
export function buildProposeServiceTool(
  ctx: ActionContext,
  captured: ServiceProposal[],
): ClientTool {
  return {
    definition: PROPOSE_SERVICE_TOOL_DEF,
    name: 'propose_service',
    run: async (raw) => {
      const args = (raw ?? {}) as {
        display_name?: string
        description?: string
        client_display_name?: string
        client_description?: string
        route?: string
        generation_mode?: string
        appointment_required?: unknown
        summary?: string
        confidence?: number
      }
      const displayName = (args.display_name ?? '').trim()
      if (!displayName) {
        return 'A display_name is required to propose a service; nothing was captured.'
      }
      // Client tile copy (Phase 2): required, outcome-only, no jurisdiction, <=70
      // chars. Rejected here so the MODEL rewrites it well; the upsert handler's
      // truncate-and-flag cap stays as the last line if something slips through.
      const clientDisplayName = (args.client_display_name ?? '').trim()
      const clientDescription = (args.client_description ?? '').trim()
      if (!clientDisplayName || !clientDescription) {
        return 'client_display_name and client_description are REQUIRED — the outcome-only copy the public intake tile shows ("Last Will & Testament", not the attorney-facing name). Nothing was captured.'
      }
      for (const [field, value] of [
        ['client_display_name', clientDisplayName],
        ['client_description', clientDescription],
      ] as const) {
        const violation = clientCopyViolation(field, value)
        if (violation) return `The proposal was NOT captured: ${violation}`
      }
      // The description is CLIENT-FACING (it shows on the public booking page). The firm
      // rule: it must never expose internal mechanics. Reject the most unambiguous
      // leaks — automation/workflow/assembly language — so the model rewrites it in
      // plain client terms rather than capturing "auto-generated from intake …".
      const description = (args.description ?? '').trim()
      const internalLeak = description.match(
        /\bauto-?generat\w*|\btemplate[ -]?merge\b|\bworkflow\b|\bintake\b|\bthe system\b|\bgeneration mode\b/i,
      )
      if (internalLeak) {
        return `The description was NOT captured: it is shown to CLIENTS on the booking page, so it must not mention internal mechanics ("${internalLeak[0]}"). Rewrite it in plain client-facing language about WHAT the client gets and its value — never how it is produced — then call propose_service again.`
      }
      // Route + generation mode are REQUIRED — NEVER defaulted. Defaulting to
      // 'manual'/'template_merge' is the founder-reported bug; both must be settled
      // with the attorney in the interview. If the model omits either, refuse to
      // capture and tell it to derive-and-confirm, rather than silently birthing a
      // manual, template-merge service.
      const route = (args.route ?? '').trim() as WorkflowRoute
      const generationMode = (args.generation_mode ?? '').trim() as GenerationMode
      if (!route || !generationMode) {
        return 'route and generation_mode are REQUIRED and must NOT be assumed — derive them from the attorney\'s process walkthrough and CONFIRM each in plain language via ask_build_question (no platform vocabulary: describe who drives the matter and how documents are produced, not "route"/"generation_mode") before proposing. Nothing was captured.'
      }
      // Booking mode is the same class of choice as route/mode: explicit, never
      // defaulted (BUILDER-CERT-1 WP3 — the drive found document-review services
      // silently demanding a consultation slot because nothing could say otherwise).
      if (typeof args.appointment_required !== 'boolean') {
        return 'appointment_required is REQUIRED and must NOT be assumed — derive from the walkthrough whether booking starts with a consultation appointment (true) or the work starts straight from intake (false, e.g. document-review), and confirm in plain language only if genuinely ambiguous. Nothing was captured.'
      }

      // Uniqueness needs the existing keys — one read, shared with the validation.
      const context = await loadServiceAuthoringContext(ctx)
      const validation = validateProposedService(
        { displayName, route, generationMode },
        context.serviceKeys,
      )
      if (!validation.ok) {
        return `The proposed service is not valid and was NOT captured. Fix these and call propose_service AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button): ${validation.errors.join('; ')}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      const derivedKey = slugifyServiceKey(displayName)
      captured.push({
        displayName,
        derivedKey,
        description: description || null,
        clientDisplayName,
        clientDescription,
        route,
        generationMode,
        appointmentRequired: args.appointment_required,
        summary: (args.summary ?? '').trim() || `Proposed new service "${displayName}".`,
        confidence,
      })
      return `The proposed service "${displayName}" (key "${derivedKey}") is shown to the attorney as an approval card; it is NOT created until they approve. The card renders BELOW your reply (never say "above"). If you already wrote a framing sentence this turn, reply with an EMPTY message — otherwise ONE short sentence; NEVER repeat the proposal details in prose.`
    },
  }
}

// ─── Completeness (read-only) ───────────────────────────────────────────────
//
// The build-wizard orchestrator needs to know, mid-build, whether a service is
// enableable yet — the SAME gate the "Enable service" button uses. This wraps the
// existing legal.service.completeness READ (serviceCompleteness) so the model can
// check readiness before it ever tells the attorney the service is live. It is
// READ-ONLY: no capture, no write, no proposal — it just returns { serviceKey,
// ready, missing } so the model can read back the missing reasons and loop.
const SERVICE_COMPLETENESS_TOOL_DEF = {
  name: 'get_service_completeness',
  description:
    'Check whether a service is complete enough to ENABLE (make bookable). Returns { serviceKey, ready, missing }: `ready` is true only when the service has a questionnaire and — for auto-route services — every document kind has a drafting prompt with all required slots and a resolvable body template; `missing` lists the human-readable reasons it is not yet enableable. Call this DURING a guided service build before you ever tell the attorney the service is ready or live — NEVER claim a service is live unless this returns ready:true. It does NOT change anything.',
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description:
          "The kind_name of the service to check (e.g. 'nc_single_member_llc_formation').",
      },
    },
    required: ['service_key'],
    additionalProperties: false,
  },
}

// Read-only completeness tool. Returns the { serviceKey, ready, missing } shape as
// JSON. No capture, no write — it delegates to serviceCompleteness, the single
// source of truth the Enable gate also uses.
export function buildServiceCompletenessTool(ctx: ActionContext): ClientTool {
  return {
    definition: SERVICE_COMPLETENESS_TOOL_DEF,
    name: 'get_service_completeness',
    run: async (raw) => {
      const args = (raw ?? {}) as { service_key?: string }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'A service_key is required to check service completeness.'
      const completeness = await serviceCompleteness(ctx, serviceKey)
      return JSON.stringify(completeness)
    },
  }
}
