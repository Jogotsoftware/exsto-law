// AI authoring of service workflows (PR5) — the substrate-facing half of the
// "build the workflow in the chatbot" feature. Two pieces:
//   • loadWorkflowAuthoringContext — a READ-ONLY context loader the chat tool gives
//     the model: the CLOSED catalog (what a step may do + who advances an edge), the
//     service's CURRENT lifecycle graph, and the firm's available document templates
//     (so the model attaches documents ONLY from the real library, never invented).
//   • setServiceLifecycleAI — the AI WRITE path. The chat turn never writes; this is
//     called by the attorney-gated approve route. It persists a reasoning_trace FIRST
//     (mirroring generateDraft's agent-actor + clamped-confidence discipline), then
//     submits legal.service.set_lifecycle AS THE AGENT ACTOR with intent 'adjustment'
//     and the trace id, so the version write carries full AI provenance.
//
// Every AI write here is sourced to the seeded Claude agent actor and traced — the
// same contract generateDraft.ts follows (CLAUDE.md hard rule: every AI write has an
// agent source, a reasoning trace, and an intent kind). No direct substrate SQL on
// the write path beyond the reasoning_trace insert (the action layer's own pattern,
// copied from generateDraft); the graph write itself goes through the action layer.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  STEP_ACTION_CATALOG,
  GATE_KINDS,
  validateLifecycle,
  validateLinearLifecycle,
  type StepActionSpec,
  type GateKind,
  type Lifecycle,
} from '../lifecycle/index.js'
import { getServiceLifecycle } from './serviceLifecycle.js'
import { listStandaloneTemplates } from '../queries/templates.js'
import { listWorkflowStepTemplates } from '../queries/workflowStepLibrary.js'
import { listCapabilities, type Capability } from '../queries/capabilities.js'
import type { CapabilityStepConfig } from '../lifecycle/types.js'

// The AI agent actor seeded by the core foundation ("Claude", actor_type=agent) —
// the SAME id generateDraft.ts sources its writes to.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

// A document template the model may attach to a step (decision 2: attach documents
// ONLY from the EXISTING library). The model references one by templateEntityId in a
// stage's documents[]; the proposal validator checks every referenced id is real.
export interface AvailableTemplate {
  templateEntityId: string
  name: string
  docKind: string | null
}

// A reusable saved STEP (workflow_step_template) the firm has in its library
// (Phase 5 — reuse), summarized so the model can drop a saved task/step in instead
// of authoring one from scratch. The stored stage carries the label/action/gate/
// documents (no edges — the builder wires those at insertion), so a one-line stage
// summary (the action kind + gate) is enough to recognize a reusable step.
export interface ReusableStepSummary {
  workflowStepTemplateId: string
  name: string
  description: string | null
  // A compact read-out of what the saved step does — its action kind + default gate.
  stageSummary: string
}

// A capability the builder may wire into a stage as an `invoke_capability` step
// (ADR 0046) — the runnable half of the registry, summarized so the model knows what
// it does, what it needs, who provides each input, and the standing config to
// capture. The model references it by `slug` in the stage's action.config.
export interface InvocableCapabilitySummary {
  slug: string
  name: string
  purpose: string
  defaultGate: GateKind
  inputsByProvidedBy: Record<string, string[]>
  configSchema: Record<string, unknown> | null
}

// The read-only context the chat tool hands the model: the closed catalog, the
// service's current graph (null when unauthored), the firm's document library, the
// firm's reusable STEP library (Phase 5), and the runnable capabilities (ADR 0046).
export interface WorkflowAuthoringContext {
  serviceKey: string
  actions: StepActionSpec[]
  gates: readonly GateKind[]
  currentGraph: Lifecycle | null
  currentVersion: number | null
  availableTemplates: AvailableTemplate[]
  // Phase 5 — the firm's saved, reusable workflow steps, so the model can reuse a
  // step/task it already has rather than composing an identical one from scratch.
  stepLibrary: ReusableStepSummary[]
  // ADR 0046 — the platform's step-invocable capabilities, alongside the 8 built-in
  // step actions. Express a mid-service client ask or an AI task as an
  // invoke_capability stage that references one of these by slug.
  invocableCapabilities: InvocableCapabilitySummary[]
}

// Load everything the model needs to PROPOSE a workflow for an existing service: the
// closed catalog (the only step kinds + gates it may compose from), the current
// lifecycle to edit, and the document templates it may attach. Read-only.
export async function loadWorkflowAuthoringContext(
  ctx: ActionContext,
  serviceKey: string,
): Promise<WorkflowAuthoringContext> {
  const current = await getServiceLifecycle(ctx, serviceKey)
  // Only DOCUMENT templates are attachable to a step (email templates are for
  // notifications, not step deliverables).
  const templates = await listStandaloneTemplates(ctx)
  const availableTemplates: AvailableTemplate[] = templates
    .filter((t) => t.category === 'document')
    .map((t) => ({ templateEntityId: t.templateEntityId, name: t.name, docKind: t.docKind }))
  // Phase 5 — the firm's reusable STEP library. A one-line stage summary (action
  // kind + default gate) is enough for the model to recognize a reusable step and
  // mirror it rather than authoring an identical one from scratch.
  const stepLibrary: ReusableStepSummary[] = (await listWorkflowStepTemplates(ctx)).map((s) => ({
    workflowStepTemplateId: s.workflowStepTemplateId,
    name: s.name,
    description: s.description,
    stageSummary: `action=${s.stage.action?.kind ?? 'manual_task'}, gate=${s.stage.gate ?? 'attorney'}`,
  }))
  // ADR 0046 — the runnable capabilities (available + step_invocable), summarized for
  // the builder: what each does, who provides each input, and the config to capture.
  const invocableCapabilities: InvocableCapabilitySummary[] = (await listCapabilities(ctx))
    .filter((c) => c.status === 'available' && c.spec.step_invocable === true)
    .map((c) => {
      const inputsByProvidedBy: Record<string, string[]> = {}
      for (const inp of c.spec.inputs ?? []) {
        ;(inputsByProvidedBy[inp.provided_by] ??= []).push(
          `${inp.key}${inp.required ? '' : ' (optional)'}${inp.description ? ` — ${inp.description}` : ''}`,
        )
      }
      return {
        slug: c.slug,
        name: c.spec.name,
        purpose: c.spec.purpose ?? '',
        defaultGate: (c.spec.default_gate ?? 'attorney') as GateKind,
        inputsByProvidedBy,
        configSchema: c.spec.config_schema ?? null,
      }
    })
  return {
    serviceKey,
    actions: STEP_ACTION_CATALOG,
    gates: GATE_KINDS,
    currentGraph: current?.graph ?? null,
    currentVersion: current?.version ?? null,
    availableTemplates,
    stepLibrary,
    invocableCapabilities,
  }
}

// The set of document-template entity ids a graph's stages reference by
// templateEntityId. Shared by the AI proposal validator (below) and the manual
// set_lifecycle handler's dangling-ref check, so both reject the same way and can
// never drift. Pure (no DB).
export function collectReferencedTemplateIds(graph: Lifecycle): string[] {
  const ids = new Set<string>()
  for (const s of graph) {
    for (const d of s.documents ?? []) {
      if (d.templateEntityId) ids.add(d.templateEntityId)
    }
  }
  return [...ids]
}

// Light config check against a capability's config_schema (ADR 0046). config_schema
// is a permissive JSON-Schema-ish map { key: { type?, required?, description? } };
// we enforce the one thing that matters at authoring time — every REQUIRED key has a
// non-empty value in the stage's capability_config — rather than a full validator.
function validateCapabilityConfig(
  stageKey: string,
  slug: string,
  schema: Record<string, unknown> | undefined,
  config: Record<string, unknown>,
): string[] {
  if (!schema || typeof schema !== 'object') return []
  const errors: string[] = []
  const props = (schema.properties as Record<string, unknown> | undefined) ?? schema
  for (const [key, raw] of Object.entries(props)) {
    const field = (raw && typeof raw === 'object' ? raw : {}) as { required?: boolean }
    if (field.required) {
      const v = config[key]
      const empty = v == null || (typeof v === 'string' && !v.trim())
      if (empty)
        errors.push(
          `stage "${stageKey}" runs capability "${slug}" but its required config "${key}" is missing`,
        )
    }
  }
  return errors
}

// Validate a PROPOSED graph the way the authoring path will write it: structural
// validity (incl. the closed action-kind vocabulary), linear-only, every referenced
// templateEntityId real, and — ADR 0046 — every invoke_capability stage names a
// capability that is LIVE and step-invocable, with a config that satisfies its
// config_schema. Returns the same shape as validateLifecycle so the propose tool can
// surface the combined errors verbatim.
export async function validateProposedLifecycle(
  ctx: ActionContext,
  graph: Lifecycle,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  errors.push(...validateLifecycle(graph).errors)
  errors.push(...validateLinearLifecycle(graph).errors)

  // Referenced template ids must exist in the firm's document library. Collect the
  // ids the graph references, then check them against the real library in one read.
  const referencedIds = new Set<string>(collectReferencedTemplateIds(graph))
  if (referencedIds.size > 0) {
    const library = await listStandaloneTemplates(ctx)
    const known = new Set(
      library.filter((t) => t.category === 'document').map((t) => t.templateEntityId),
    )
    for (const id of referencedIds) {
      if (!known.has(id))
        errors.push(`referenced document template "${id}" is not in the firm library`)
    }
  }

  // ADR 0046 — invoke_capability stages. Load the registry once only if the graph
  // actually uses one (keeps the common case a single template read).
  const capabilityStages = graph.filter((s) => s.action?.kind === 'invoke_capability')
  if (capabilityStages.length > 0) {
    const registry = await listCapabilities(ctx)
    const bySlug = new Map<string, Capability>(registry.map((c) => [c.slug, c]))
    for (const s of capabilityStages) {
      const cfg = (s.action?.config ?? {}) as unknown as CapabilityStepConfig
      const slug = (cfg.capability_slug ?? '').trim()
      if (!slug) {
        errors.push(`stage "${s.key}" is an invoke_capability step but names no capability_slug`)
        continue
      }
      const cap = bySlug.get(slug)
      if (!cap) {
        errors.push(`stage "${s.key}" references unknown capability "${slug}"`)
        continue
      }
      if (cap.status !== 'available') {
        errors.push(
          `stage "${s.key}" references capability "${slug}" which is not available (status=${cap.status})`,
        )
      }
      if (cap.spec.step_invocable !== true) {
        errors.push(
          `stage "${s.key}" references capability "${slug}" which is not step-invocable (it cannot run as a workflow step)`,
        )
      }
      errors.push(
        ...validateCapabilityConfig(
          s.key,
          slug,
          cap.spec.config_schema,
          (cfg.capability_config ?? {}) as Record<string, unknown>,
        ),
      )
    }
  }

  return { ok: errors.length === 0, errors }
}

// Reasoning summary the approve route carries from the chat turn that produced the
// proposal — the model's framing for WHY this graph, plus an honest confidence the
// substrate clamps below 1.0 (an AI never claims certainty — ADR 0006 / 0020).
export interface WorkflowReasoning {
  conclusion: string
  evidence?: unknown[]
  alternatives?: unknown[]
  confidence?: number
  modelIdentity?: string
}

// Persist a reasoning_trace for an AI workflow authoring write (mirrors
// generateDraft.persistReasoningTrace): sourced to the Claude agent actor, with the
// confidence clamped strictly below 1.0. Returns the trace id the action references.
async function persistReasoningTrace(
  ctx: ActionContext,
  serviceKey: string,
  graph: Lifecycle,
  reasoning: WorkflowReasoning,
): Promise<string> {
  const id = randomUUID()
  const conclusion = reasoning.conclusion?.trim() || `Authored a workflow for ${serviceKey}.`
  const prompt = `Author the workflow lifecycle for service "${serviceKey}" (${graph.length} stages).`
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
        JSON.stringify({ service_key: serviceKey, graph, ...reasoning }),
      ],
    )
  })
  return id
}

// The AI write path (decision 1: the live write happens ONLY on attorney approve).
// Validates the graph, persists the reasoning_trace FIRST, then submits
// legal.service.set_lifecycle AS THE AGENT ACTOR with intent 'adjustment' and the
// trace id. The handler seals the prior version and inserts version+1, so this
// inherits the same immutable-versioning + action-layer write the manual path uses.
export async function setServiceLifecycleAI(
  ctx: ActionContext,
  serviceKey: string,
  graph: Lifecycle,
  reasoning: WorkflowReasoning,
): Promise<{ workflowDefinitionId: string; serviceKey: string; version: number }> {
  // Validate BEFORE any write (incl. the trace) so an invalid proposal leaves no
  // trace row behind. The handler re-validates, but failing fast here is cleaner.
  const validation = await validateProposedLifecycle(ctx, graph)
  if (!validation.ok) {
    throw new Error(`Invalid workflow lifecycle: ${validation.errors.join('; ')}`)
  }

  // The write is AS THE AGENT, not the attorney — the trace, the action source, and
  // the configuration_change all attribute the authoring to the Claude agent actor,
  // exactly like generateDraft.runDraftGeneration.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const reasoningTraceId = await persistReasoningTrace(agentCtx, serviceKey, graph, reasoning)

  const res = await submitAction(agentCtx, {
    actionKindName: 'legal.service.set_lifecycle',
    intentKind: 'adjustment',
    reasoningTraceId,
    payload: { service_key: serviceKey, graph },
  })
  return res.effects[0] as { workflowDefinitionId: string; serviceKey: string; version: number }
}

// Honest confidence: an AI authoring write must never claim certainty (ADR 0006).
// Same shape as generateDraft.clampConfidence but INTENTIONALLY stricter — capped at
// 0.99 (never 1.0), with a deliberately humble 0.6 fallback when no value is given,
// because authoring firm configuration is higher-stakes than drafting a document.
function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.6
  return Math.min(0.99, Math.max(0, n))
}
