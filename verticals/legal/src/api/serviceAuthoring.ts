// AI authoring of NEW services (Build-Wizard Phase 1) — the substrate-facing half
// of "propose a new service shell in the chatbot". It mirrors workflowAuthoring.ts
// exactly, one layer up: where that file authors a WORKFLOW onto an existing
// service, this file CREATES the empty service the wizard's later phases bind a
// questionnaire/templates/workflow to. Two pieces:
//   • loadServiceAuthoringContext — a READ-ONLY context loader the chat tool gives
//     the model: the existing service_keys (so it can check uniqueness), the closed
//     route + generation_mode vocabularies, and the firm's bundled docKind registry
//     (the document kinds a later phase can bind). The model composes a proposal
//     ONLY from these; it never invents a route or a generation mode.
//   • createServiceAI — the AI WRITE path. The chat turn never writes; this is
//     called by the attorney-gated approve route. It persists a reasoning_trace
//     FIRST (mirroring workflowAuthoring's agent-actor + clamped-confidence
//     discipline), then submits legal.service.upsert AS THE AGENT ACTOR with intent
//     'exploration' (a new service is a creation, not an adjustment) and the trace
//     id, so the version-1 row carries full AI provenance.
//
// Every AI write here is sourced to the seeded Claude agent actor and traced — the
// same contract workflowAuthoring.ts / generateDraft.ts follow (CLAUDE.md hard rule
// 4/7: every AI write has an agent source, a reasoning trace, and an intent kind).
// No direct substrate SQL on the write path beyond the reasoning_trace insert (the
// action layer's own pattern, copied from workflowAuthoring); the service row itself
// is written by the action layer (legal.service.upsert → version 1, DISABLED).
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  listServicesIncludingInactive,
  listServiceDocumentTemplates,
  type WorkflowRoute,
} from './services.js'
import { getServiceLifecycle } from './serviceLifecycle.js'
import type { GenerationMode } from './generateDraft.js'
import { listStandaloneTemplates } from '../queries/templates.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// the SAME id workflowAuthoring.ts / generateDraft.ts source their writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// The closed vocabularies a proposed service may use. Kept as const tuples so the
// propose tool's input_schema enums and the validator read from ONE source — the
// model can never invent a route or generation mode that the write path rejects.
export const SERVICE_ROUTES: readonly WorkflowRoute[] = ['auto', 'manual'] as const
export const SERVICE_GENERATION_MODES: readonly GenerationMode[] = [
  'template_merge',
  'ai_draft',
] as const

// Slugify a display name into a stable kind_name. MUST match the slugify in the
// legal.service.upsert handler (handlers/serviceLibrary.ts) so the uniqueness check
// the propose tool runs against loadServiceAuthoringContext's service_keys predicts
// the SAME base key the handler will derive. (The handler still has the final say,
// disambiguating a collision with a _2/_3 suffix; this is the optimistic guard.)
export function slugifyServiceKey(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'service'
  )
}

// One existing service summarized for REUSE detection (Phase 5). Enough for the
// model to recognize "a service like this already exists" and propose EDITING it
// rather than authoring a duplicate: the key + display name + description, and a
// shape read-out (does it already have a workflow / questionnaire / how many
// document templates, and of which kinds). All read-only, composed from the SAME
// listServicesIncludingInactive the admin Services list uses.
export interface ExistingServiceSummary {
  serviceKey: string
  displayName: string
  description: string | null
  // True when the service has an authored lifecycle graph (its workflow is built).
  hasWorkflow: boolean
  // True when the service has at least one intake-schema section with a field.
  hasQuestionnaire: boolean
  // How many document templates the service has authored (by docKind), and which.
  templateCount: number
  docKinds: string[]
}

// The read-only context the chat tool hands the model: the existing service keys
// (for uniqueness), the EXISTING-SERVICE SUMMARIES (for reuse detection — Phase 5),
// the closed route + generation_mode vocabularies, and the firm's bundled docKind
// registry (the document kinds a later wizard phase can bind).
export interface ServiceAuthoringContext {
  // Every existing service kind_name (active OR disabled) — the model checks a
  // proposed key against these so it never proposes a duplicate.
  serviceKeys: string[]
  // Phase 5 — the firm's existing services, summarized enough that the model can
  // recognize a close match and propose EDITING it rather than creating a duplicate.
  existingServices: ExistingServiceSummary[]
  routes: readonly WorkflowRoute[]
  generationModes: readonly GenerationMode[]
  // Distinct document kinds present in the firm's document-template library — the
  // bundled docKind registry a later wizard phase binds documents from.
  docKinds: string[]
}

// All distinct service kind_names across EVERY version (current AND sealed), minus
// the firm.* internal kinds — the SAME set the legal.service.upsert handler's
// uniqueKindName check sees. The uniqueness preview reads THIS (not just current
// versions) so the derived key shown to the attorney matches the key the handler
// will actually write, even when a name collides with a sealed (superseded/retired)
// version that listServicesIncludingInactive (valid_to IS NULL only) would miss.
export async function listAllServiceKinds(ctx: ActionContext): Promise<string[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ kind_name: string }>(
      `SELECT DISTINCT kind_name FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name NOT LIKE 'firm.%'`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => r.kind_name)
  })
}

// Summarize the firm's existing services for REUSE detection (Phase 5). Reads the
// admin Services list (current row of every service, active OR disabled — minus the
// firm.* internals, which that query already excludes) and, for each, the document
// templates authored on it. The hasWorkflow / hasQuestionnaire / templateCount /
// docKinds flags are exactly what the model needs to see "this already exists" and
// propose editing instead of duplicating. Read-only — composes existing queries.
export async function summarizeExistingServices(
  ctx: ActionContext,
): Promise<ExistingServiceSummary[]> {
  const services = await listServicesIncludingInactive(ctx)
  // Each service's authored document templates (by docKind) — one read per service,
  // resolved in parallel so the context load stays within the per-op budget.
  const summaries = await Promise.all(
    services.map(async (s) => {
      const docs = await listServiceDocumentTemplates(ctx, s.serviceKey)
      const docKinds = docs.map((d) => d.documentKind).sort()
      // A built workflow == an authored, valid lifecycle graph (not the derived
      // fallback). getServiceLifecycle returns null when nothing is authored yet.
      const lifecycle = await getServiceLifecycle(ctx, s.serviceKey)
      const hasQuestionnaire = (s.intakeSchema?.sections ?? []).some(
        (sec) => Array.isArray(sec.fields) && sec.fields.length > 0,
      )
      return {
        serviceKey: s.serviceKey,
        displayName: s.displayName,
        description: s.description,
        hasWorkflow: lifecycle != null,
        hasQuestionnaire,
        templateCount: docKinds.length,
        docKinds,
      }
    }),
  )
  return summaries
}

// Load everything the model needs to PROPOSE a new service shell: the existing keys
// (uniqueness — all versions, matching the handler), the existing-service summaries
// (reuse — Phase 5), the closed route/generation_mode vocabularies, and the docKind
// registry. Read-only — composes existing queries.
export async function loadServiceAuthoringContext(
  ctx: ActionContext,
): Promise<ServiceAuthoringContext> {
  const serviceKeys = await listAllServiceKinds(ctx)
  const existingServices = await summarizeExistingServices(ctx)
  // Only DOCUMENT templates carry a bindable docKind (email templates are for
  // notifications). De-dup, drop empties, and sort for a stable registry.
  const templates = await listStandaloneTemplates(ctx)
  const docKinds = [
    ...new Set(
      templates
        .filter((t) => t.category === 'document' && t.docKind)
        .map((t) => t.docKind as string),
    ),
  ].sort()
  return {
    serviceKeys,
    existingServices,
    routes: SERVICE_ROUTES,
    generationModes: SERVICE_GENERATION_MODES,
    docKinds,
  }
}

// A proposed new-service shell captured this turn — what the model proposes plus the
// derived key. The chat surfaces it as an inline approval card; the attorney
// approves it, which posts the create-from-ai route (the only place a live write
// happens). Mirrors WorkflowProposal: a captured, not-yet-persisted shape.
export interface ServiceProposal {
  displayName: string
  // The kind_name slugifyServiceKey would derive — shown on the card so the
  // attorney sees the key before approving (the handler has the final say).
  derivedKey: string
  description: string | null
  route: WorkflowRoute
  generationMode: GenerationMode
  summary: string
  confidence: number
}

// Validate a proposed service shell the way the create path will write it: a
// non-empty display name, a route + generation_mode from the closed vocabularies,
// and a derived key that does not already exist. Returns the same { ok, errors }
// shape workflowAuthoring's validator does so the propose tool surfaces errors
// verbatim. Takes the existing keys (already loaded for the context) to avoid a
// second read.
export function validateProposedService(
  input: { displayName: string; route: WorkflowRoute; generationMode: GenerationMode },
  existingKeys: readonly string[],
): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const displayName = (input.displayName ?? '').trim()
  if (!displayName) errors.push('a display name is required')
  if (!SERVICE_ROUTES.includes(input.route)) {
    errors.push(`route must be one of: ${SERVICE_ROUTES.join(', ')}`)
  }
  if (!SERVICE_GENERATION_MODES.includes(input.generationMode)) {
    errors.push(`generation_mode must be one of: ${SERVICE_GENERATION_MODES.join(', ')}`)
  }
  if (displayName) {
    const key = slugifyServiceKey(displayName)
    if (existingKeys.includes(key)) {
      errors.push(`a service with key "${key}" already exists — choose a different name`)
    }
  }
  return { ok: errors.length === 0, errors }
}

// Reasoning summary the approve route carries from the chat turn that produced the
// proposal — the model's framing for WHY this service, plus an honest confidence the
// substrate clamps below 1.0 (an AI never claims certainty — ADR 0006 / 0020).
export interface ServiceReasoning {
  conclusion: string
  evidence?: unknown[]
  alternatives?: unknown[]
  confidence?: number
  modelIdentity?: string
}

// The full proposed-shell shape the create path persists.
export interface CreateServiceAIInput {
  displayName: string
  description?: string | null
  route?: WorkflowRoute
  generationMode?: GenerationMode
}

// Persist a reasoning_trace for an AI service-creation write (mirrors
// workflowAuthoring.persistReasoningTrace): sourced to the Claude agent actor, with
// the confidence clamped strictly below 1.0. Returns the trace id the action
// references.
async function persistReasoningTrace(
  ctx: ActionContext,
  input: CreateServiceAIInput,
  reasoning: ServiceReasoning,
): Promise<string> {
  const id = randomUUID()
  const conclusion = reasoning.conclusion?.trim() || `Created the service "${input.displayName}".`
  const prompt = `Create a new service shell named "${input.displayName}".`
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
        JSON.stringify({ ...input, ...reasoning }),
      ],
    )
  })
  return id
}

// The AI write path (the live write happens ONLY on attorney approve). Validates the
// shell, persists the reasoning_trace FIRST, then submits legal.service.upsert AS
// THE AGENT ACTOR with intent 'exploration' and the trace id. The handler creates
// version 1, DISABLED (a new service is never live until the attorney completes and
// enables it), so this inherits the same immutable-versioning + action-layer write
// the manual create path (createService) uses. generation_mode rides in via the
// handler's transitions_patch (the only metadata key createService doesn't pass).
export async function createServiceAI(
  ctx: ActionContext,
  input: CreateServiceAIInput,
  reasoning: ServiceReasoning,
): Promise<{ serviceKey: string; version: number }> {
  const displayName = (input.displayName ?? '').trim()
  const route: WorkflowRoute = input.route ?? 'manual'
  const generationMode: GenerationMode = input.generationMode ?? 'template_merge'

  // Validate BEFORE any write (incl. the trace) so an invalid proposal leaves no
  // trace row behind. Check uniqueness against ALL versions (matching the handler).
  const existingKeys = await listAllServiceKinds(ctx)
  const validation = validateProposedService({ displayName, route, generationMode }, existingKeys)
  if (!validation.ok) {
    throw new Error(`Invalid service proposal: ${validation.errors.join('; ')}`)
  }

  // The write is AS THE AGENT, not the attorney — the trace, the action source, and
  // the configuration_change all attribute the creation to the Claude agent actor,
  // exactly like setServiceLifecycleAI.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const reasoningTraceId = await persistReasoningTrace(
    agentCtx,
    { displayName, description: input.description ?? null, route, generationMode },
    reasoning,
  )

  const res = await submitAction(agentCtx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'exploration',
    reasoningTraceId,
    payload: {
      // No service_key → the handler creates a new version-1, DISABLED row.
      display_name: displayName,
      description: input.description ?? null,
      route,
      // generation_mode isn't a top-level upsert field — it merges through the
      // transitions patch, the same path updateServiceMetadata uses for it.
      transitions_patch: { generation_mode: generationMode },
    },
  })
  return res.effects[0] as { serviceKey: string; version: number }
}

// Honest confidence: an AI creation write must never claim certainty (ADR 0006).
// Same shape as workflowAuthoring.clampConfidence — capped at 0.99 (never 1.0), with
// a deliberately humble 0.6 fallback when no value is given, because authoring firm
// configuration is higher-stakes than drafting a document.
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
