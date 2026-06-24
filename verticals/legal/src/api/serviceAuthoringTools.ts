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
    "Get everything needed to PROPOSE a new SERVICE for this firm: the existing service keys (so your proposed service's key is unique), the closed set of workflow routes you may pick ('manual' or 'auto'), the closed set of document generation modes ('template_merge' or 'ai_draft'), and the firm's bundled document-kind registry (the kinds a later step can attach). Compose a service ONLY from these — never invent a route or a generation mode. Call this FIRST whenever the attorney asks you to create, set up, or add a new service offering.",
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
        description: 'A one-line description of what the service does (optional).',
      },
      route: {
        type: 'string',
        enum: SERVICE_ROUTES as unknown as string[],
        description:
          "How the matter is worked: 'manual' (the attorney drives it) or 'auto' (documents draft from intake). Defaults to 'manual' when omitted.",
      },
      generation_mode: {
        type: 'string',
        enum: SERVICE_GENERATION_MODES as unknown as string[],
        description:
          "How documents are produced: 'template_merge' (deterministic merge, no AI) or 'ai_draft' (AI drafting). Defaults to 'template_merge' when omitted.",
      },
      summary: {
        type: 'string',
        description:
          'A one-paragraph plain-language summary of WHY this service and what it is for. Shown to the attorney and recorded as the reasoning trace on approve.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: ['display_name'],
    additionalProperties: false,
  },
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
        route?: string
        generation_mode?: string
        summary?: string
        confidence?: number
      }
      const displayName = (args.display_name ?? '').trim()
      if (!displayName) {
        return 'A display_name is required to propose a service; nothing was captured.'
      }
      // Default the closed-vocab fields the same way the write path does, so the
      // validator (and the model) see the value that will actually be written.
      const route = (args.route ?? 'manual') as WorkflowRoute
      const generationMode = (args.generation_mode ?? 'template_merge') as GenerationMode

      // Uniqueness needs the existing keys — one read, shared with the validation.
      const context = await loadServiceAuthoringContext(ctx)
      const validation = validateProposedService(
        { displayName, route, generationMode },
        context.serviceKeys,
      )
      if (!validation.ok) {
        return `The proposed service is not valid and was NOT captured. Fix these and call propose_service again: ${validation.errors.join('; ')}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      const derivedKey = slugifyServiceKey(displayName)
      captured.push({
        displayName,
        derivedKey,
        description: (args.description ?? '').trim() || null,
        route,
        generationMode,
        summary: (args.summary ?? '').trim() || `Proposed new service "${displayName}".`,
        confidence,
      })
      return `The proposed service "${displayName}" (key "${derivedKey}") is shown to the attorney as an approval card; it is NOT created until they approve. Reply with ONE short sentence pointing them to it; do NOT repeat the proposal details in prose.`
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
