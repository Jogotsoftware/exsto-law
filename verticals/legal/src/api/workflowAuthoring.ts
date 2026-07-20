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
  AUTHORABLE_STEP_ACTION_CATALOG,
  isDeprecatedStepActionKind,
  GATE_KINDS,
  validateLifecycle,
  validateLinearLifecycle,
  validateBlockingReachability,
  isBlockingStage,
  hasProducingRunner,
  buildInvokeCapabilityStepTemplate,
  capabilityConfigSchemaProps,
  diagnoseCapabilityStepConfig,
  diagnoseMissingCapabilitySlug,
  diagnoseEdgeTransition,
  GATE_TRANSITION_VOCABULARY,
  type GateTransitionOption,
  type StepActionSpec,
  type GateKind,
  type Lifecycle,
  type StepAction,
} from '../lifecycle/index.js'
import { getServiceLifecycle } from './serviceLifecycle.js'
import { getService } from './services.js'
import { computeBillingReadout, formatBillingReadout } from './billingReadout.js'
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
// capture. `stepTemplate` (WORKFLOW-AUTHORING-1) is the literal `stage.action`
// shape to emit for THIS capability, GENERATED from the same config_schema the
// validator checks — copy it verbatim, replacing the <…> placeholder values with
// the real ones. Never invent the wrapper keys; they are always exactly
// `capability_slug` (a direct child of action.config) and `capability_config` (a
// nested object holding the schema's fields) — see `stepTemplate` for the proof.
export interface InvocableCapabilitySummary {
  slug: string
  name: string
  purpose: string
  defaultGate: GateKind
  inputsByProvidedBy: Record<string, string[]>
  configSchema: Record<string, unknown> | null
  stepTemplate: { action: StepAction }
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
  // WORKFLOW-AUTHORING-1 — the EXACT advance tokens per gate. An attorney/client edge
  // MUST set `via` to one of gateTransitions[gate].options[].token; a system edge MUST
  // set `on` to one; automatic edges are free-form. Pick the token whose label matches
  // what advances the step — never write prose or invent a token, or the edge can't fire.
  gateTransitions: Record<GateKind, { field: 'via' | 'on' | null; options: GateTransitionOption[] }>
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
  // P11 — `authorable: false` hides a capability from NEW authoring only (e.g.
  // transcript_extraction, which now fires automatically on transcript arrival).
  // Deliberately NOT enforced in validateProposedLifecycle: existing graphs that
  // already carry such a stage must keep validating and running.
  const invocableCapabilities: InvocableCapabilitySummary[] = (await listCapabilities(ctx))
    .filter(
      (c) =>
        c.status === 'available' &&
        c.spec.step_invocable === true &&
        (c.spec as { authorable?: boolean }).authorable !== false,
    )
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
        stepTemplate: buildInvokeCapabilityStepTemplate({ slug: c.slug, spec: c.spec }),
      }
    })
  return {
    serviceKey,
    // WP5 — offer only the AUTHORABLE catalog (deprecated kinds like generate_document
    // are excluded; new drafting steps are authored as invoke_capability{document_generation}).
    actions: AUTHORABLE_STEP_ACTION_CATALOG,
    gates: GATE_KINDS,
    currentGraph: current?.graph ?? null,
    currentVersion: current?.version ?? null,
    availableTemplates,
    stepLibrary,
    invocableCapabilities,
    gateTransitions: GATE_TRANSITION_VOCABULARY,
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

// Does this stage PRODUCE a document (and so bear a potential fee)? The two
// document-producing step shapes: the legacy generate_document kind and an
// invoke_capability stage running document_generation (CAPABILITY-UNIFY-1).
// Exported for the propose tool's compose-ordering pre-gate (BUILDER-UX-3 P4).
export function isDocumentProducingStage(s: Lifecycle[number]): boolean {
  if (s.action?.kind === 'generate_document') return true
  if (s.action?.kind === 'invoke_capability') {
    const cfg = (s.action.config ?? {}) as { capability_slug?: string }
    return (cfg.capability_slug ?? '').trim() === 'document_generation'
  }
  return false
}

// ESIGN-BLOCK-1 (WP3) — the template id(s) a DOCUMENT-PRODUCING stage binds, in both
// shapes: an invoke_capability{document_generation} stage's capability_config.
// template_entity_id, and the legacy generate_document stage's documents[]. Used to
// decide whether the stage's output is SIGNABLE (its template declares
// signature.required).
function producingStageTemplateIds(s: Lifecycle[number]): string[] {
  const ids: string[] = []
  if (s.action?.kind === 'invoke_capability') {
    const cfg = (s.action.config ?? {}) as {
      capability_config?: { template_entity_id?: unknown }
    }
    const id = String(cfg.capability_config?.template_entity_id ?? '').trim()
    if (id) ids.push(id)
  }
  for (const d of s.documents ?? []) {
    if (d.templateEntityId) ids.push(d.templateEntityId)
  }
  return ids
}

// Validate a PROPOSED graph the way the authoring path will write it: structural
// validity (incl. the closed action-kind vocabulary), linear-only, every referenced
// templateEntityId real, and — ADR 0046 — every invoke_capability stage names a
// capability that is LIVE and step-invocable, with a config that satisfies its
// config_schema. Returns the same shape as validateLifecycle so the propose tool can
// surface the combined errors verbatim — plus `warnings` (BUILDER-CERT-1 WP1):
// non-blocking diagnostics the propose tool surfaces on the card. Today's one
// warning: the service declares BOTH per-document fees AND a fixed service fee, so
// the composed billing charges twice per matter — legitimate only when deliberate
// (a split), so it warns rather than rejects.
//
// BACKHALF-BLOCKS-1 (WP2) — a service's workflow must also DECLARE how it completes
// and when it bills:
//   • completion: the graph must end in a `complete_matter` terminal stage (the step
//     Contract W's complete endpoint executes: legal.service.complete + archive).
//   • billing: a graph that PRODUCES documents must carry a billing declaration —
//     per-document fees on the service (transitions.document_fees, accrued on
//     draft.approve — WP1) and/or an explicit approve_send_invoice step. Checked
//     only when the caller passes `serviceKey` (both write paths do); a bare graph
//     validation (no service context) skips just the fee lookup, not the completion
//     check. Authoring-only, like every check here: existing saved definitions keep
//     validating and running.
//
// BUILDER-UX-3 (P4) — `pendingBilling` is a billing proposal captured EARLIER IN THE
// SAME TURN (propose_cost is capture-only; nothing persists until the attorney
// approves the cost card). Compose-time validation may accept it as the billing
// declaration so the doctrine order billing-then-workflow works within one turn.
// Every other caller omits it and stays strict — in particular setServiceLifecycleAI
// (the approve write path) re-validates against PERSISTED state only, so a workflow
// physically cannot persist before its cost approve has landed.
export interface PendingBilling {
  costType: 'fixed' | 'hourly'
  documentFees?: Record<string, string>
}

export async function validateProposedLifecycle(
  ctx: ActionContext,
  graph: Lifecycle,
  serviceKey?: string,
  pendingBilling?: PendingBilling,
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = []
  const warnings: string[] = []
  errors.push(...validateLifecycle(graph).errors)
  errors.push(...validateLinearLifecycle(graph).errors)
  // HOTFIX-P17 (L1) — reject a proposal that lets a blocking step be skipped on the
  // way to completion (a shortcut edge around a required step).
  errors.push(...validateBlockingReachability(graph).errors)

  // WP2 — completion declaration: the workflow must END in a completion step. Same
  // diagnostic style as the template_entity_id check: name the exact fix.
  const terminals = graph.filter((s) => s.terminal)
  if (terminals.length > 0 && !terminals.some((s) => s.action?.kind === 'complete_matter')) {
    errors.push(
      `the workflow has no completion step — its terminal stage "${terminals[0]!.key}" must be a complete_matter step (set action.kind to "complete_matter") so completing the matter accrues the service fee and archives it.`,
    )
  }

  // WP2 — billing declaration: a workflow that produces documents must state when it
  // bills. Either the service declares per-document fees (accrued on approve) or the
  // graph carries an explicit invoice step.
  const producingStages = graph.filter(isDocumentProducingStage)
  const hasInvoiceStep = graph.some((s) => s.action?.kind === 'approve_send_invoice')
  if (serviceKey) {
    const svc = await getService(ctx, serviceKey)
    const feeKinds = Object.keys(svc?.documentFees ?? {})
    // A FIXED service cost is a real billing declaration too — it auto-accrues at
    // completion (legal.service.complete). Only a producing workflow with NO fees,
    // NO invoice step, and NO flat fee produces work nobody ever bills. (Hourly
    // does not count here: nothing accrues unless time is recorded and invoiced,
    // so hourly document-producing services still need an invoice step.) A same-turn
    // pending cost/fee proposal (P4) satisfies this check at COMPOSE time only.
    const pendingFeeKinds = Object.keys(pendingBilling?.documentFees ?? {})
    const hasFixedFee = svc?.cost?.type === 'fixed' || pendingBilling?.costType === 'fixed'
    if (
      producingStages.length > 0 &&
      !hasInvoiceStep &&
      feeKinds.length === 0 &&
      pendingFeeKinds.length === 0 &&
      !hasFixedFee
    ) {
      errors.push(
        `the workflow produces a document (stage "${producingStages[0]!.key}") but declares no billing — set the service's per-document fees (transitions.document_fees, accrued when the document is approved), or a flat service fee (accrued at completion), or add an approve_send_invoice step to the graph.`,
      )
    }
    // BUILDER-CERT-1 (WP1) — split billing is a WARNING, never a rejection: per-
    // document fees PLUS a service cost (fixed doubles the total; hourly stacks
    // time-billing on top) charge the matter twice. Legitimate only when the
    // attorney chose it deliberately; the card must say it out loud.
    if (feeKinds.length > 0 && svc?.cost) {
      const feeTotal = feeKinds.reduce((sum, k) => sum + Number(svc.documentFees[k] ?? 0), 0)
      warnings.push(
        svc.cost.type === 'fixed'
          ? `split billing: this service charges per-document fee(s) totaling $${feeTotal.toFixed(2)} on approval AND a $${svc.cost.amount} service fee at completion — two charges per matter (total $${(feeTotal + Number(svc.cost.amount)).toFixed(2)}). Keep both ONLY if the attorney deliberately chose a split; otherwise remove one so the service has ONE billing point.`
          : `split billing: this service charges per-document fee(s) totaling $${feeTotal.toFixed(2)} on approval AND hourly billing at $${svc.cost.amount}/hour — two charge declarations per matter. Keep both ONLY if the attorney deliberately chose a split; otherwise remove one so the service has ONE billing point.`,
      )
    }
  }

  // WF-FIX-1 (WP7) — authoring-hygiene WARNINGS (never rejections; existing saved
  // graphs keep validating). Each names the exact fix, same diagnostic style as the
  // errors above.
  // (a) transcript.received in a graph that never schedules a consultation: no
  // booking edge and no blocking consultation step means no transcript will ever
  // be imported — the edge can never fire (the live stuck-matter class).
  const schedulesConsultation =
    graph.some((s) => s.advances_to.some((e) => e.via === 'booking.create')) ||
    graph.some((s) => s.action?.kind === 'view_consultation' && isBlockingStage(s))
  for (const s of graph) {
    for (const e of s.advances_to) {
      if (e.on === 'transcript.received' && !schedulesConsultation) {
        warnings.push(
          `stage "${s.key}" waits on 'transcript.received', but nothing in this workflow schedules a consultation — no transcript will ever arrive and the matter would wait forever. If this step should fire when the client finishes the intake form, use 'intake.completed' instead.`,
        )
      }
    }
  }
  // (b) a non-blocking stage never WAITS: pass-through traverses its outgoing edge
  // immediately, so a gate/token there is recorded but never waited on. Say it out
  // loud so "non-blocking + client gate" is an authoring signal, not a runtime
  // surprise. Producing stages are exempt — they run on entry by design.
  for (const s of graph) {
    if (s.terminal || isBlockingStage(s) || hasProducingRunner(s.action?.kind)) continue
    const edge = s.advances_to[0]
    const token = edge?.via ?? edge?.on
    if (edge && token) {
      warnings.push(
        `step "${s.label}" is informational (non-blocking): the matter moves through it immediately, so its '${token}' trigger is never waited on. Mark the step blocking if the matter should stop there.`,
      )
    }
  }
  // (c) a NON-producing workflow that completes with no billing point at all: the
  // producing case above is an error; this is the softer sibling (some services
  // are legitimately unbilled or billed off-platform).
  if (serviceKey) {
    const svc = await getService(ctx, serviceKey)
    const hasFixedFee2 = svc?.cost?.type === 'fixed' || pendingBilling?.costType === 'fixed'
    const completes = graph.some((s) => s.action?.kind === 'complete_matter')
    if (producingStages.length === 0 && completes && !hasInvoiceStep && !hasFixedFee2) {
      warnings.push(
        `this workflow reaches completion but declares no billing — no invoice step and no flat service fee${svc?.cost?.type === 'hourly' ? ' (hourly time only bills through an approve_send_invoice step)' : ''}. Add an approve_send_invoice step or a flat fee unless this service is deliberately unbilled.`,
      )
    }
  }
  // (d) no terminal at all: the matter can never complete.
  if (terminals.length === 0 && graph.length > 0) {
    warnings.push(
      `no step is marked as the end of the matter — without a terminal completion step the matter can never be completed, billed at completion, or archived. Make the last step a complete_matter step.`,
    )
  }
  // (e) a client-gated wait with nothing client-facing to act on: the exit needs a
  // client action, but the step shows the client no document/ask.
  for (const s of graph) {
    const edge = s.advances_to[0]
    if (!edge || edge.gate !== 'client' || !isBlockingStage(s)) continue
    const kind = s.action?.kind
    const clientFacing =
      kind === 'review_send_document' ||
      kind === 'invoke_capability' ||
      (s.documents?.length ?? 0) > 0 ||
      Boolean(s.client_label)
    if (!clientFacing) {
      warnings.push(
        `step "${s.label}" waits on the client ('${edge.via ?? edge.on}') but shows the client nothing to act on — no document, no request, no client-facing label. Give the step a client-facing ask (attach a document, use a request_client_materials capability, or set a client label) so the client knows what to do.`,
      )
    }
  }

  // CAPABILITY-UNIFY-1 (WP5) — a NEW proposal must not author a deprecated step kind.
  // Authoring-only (not in validateLifecycle) so EXISTING definitions with the kind
  // keep validating + running; only fresh proposals are steered to the replacement.
  for (const s of graph) {
    if (s.action && isDeprecatedStepActionKind(s.action.kind)) {
      errors.push(
        `stage "${s.key}" uses the deprecated step kind "${s.action.kind}". Author a drafting step as an invoke_capability stage running the "document_generation" capability instead (set action.config.capability_config.template_entity_id to the firm template it drafts and generation_mode to "ai_draft" or "template_merge").`,
      )
    }
  }

  // WORKFLOW-AUTHORING-1 — every attorney/client/system edge must name a REAL advance
  // token (the runtime matches on it verbatim), not prose. Not part of structural
  // validateLifecycle; since BUILDER-UX-3 P12 the manual save handler
  // (legal.service.set_lifecycle) runs the same diagnoseEdgeTransition check, so
  // dead tokens are rejected on BOTH the authoring and manual paths — the editor's
  // trigger select carries legacy off-vocabulary values losslessly until edited.
  for (const s of graph) {
    for (const e of s.advances_to) {
      const err = diagnoseEdgeTransition(s.key, e.to, e.gate, e.via, e.on)
      if (err) errors.push(err)
    }
  }

  // The firm's active document templates, loaded at most ONCE and shared by the
  // documents[] check, the capability template_entity_id check, and the e-sign
  // signability check below (a document_generation step names its template the same
  // way, by exact entity id).
  let docTemplateLibrary: Awaited<ReturnType<typeof listStandaloneTemplates>> | null = null
  const loadDocTemplates = async (): Promise<NonNullable<typeof docTemplateLibrary>> => {
    if (docTemplateLibrary) return docTemplateLibrary
    docTemplateLibrary = (await listStandaloneTemplates(ctx)).filter(
      (t) => t.category === 'document',
    )
    return docTemplateLibrary
  }
  const loadKnownDocTemplateIds = async (): Promise<Set<string>> => {
    return new Set((await loadDocTemplates()).map((t) => t.templateEntityId))
  }

  // Referenced template ids must exist in the firm's document library. Collect the
  // ids the graph references, then check them against the real library in one read.
  const referencedIds = new Set<string>(collectReferencedTemplateIds(graph))
  if (referencedIds.size > 0) {
    const known = await loadKnownDocTemplateIds()
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
      const rawConfig = (s.action?.config ?? {}) as Record<string, unknown>
      const cfg = rawConfig as unknown as CapabilityStepConfig
      const slug = (cfg.capability_slug ?? '').trim()
      if (!slug) {
        errors.push(diagnoseMissingCapabilitySlug(s.key, rawConfig))
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
      errors.push(...diagnoseCapabilityStepConfig(s.key, slug, rawConfig, cap.spec.config_schema))
      // CAPABILITY-UNIFY-1 (WP4) — a capability that drafts from a firm template (its
      // config_schema declares `template_entity_id`, e.g. document_generation) must
      // name a REAL active firm document template by exact id — the same class of check
      // as documents[] templateEntityId. Keyed off the schema (not a hardcoded slug) so
      // any future template-drafting capability inherits it. Only runs when the required
      // key is present (its absence is diagnoseCapabilityStepConfig's job).
      const schemaProps = capabilityConfigSchemaProps(cap.spec.config_schema)
      if ('template_entity_id' in schemaProps) {
        const capabilityConfig = (cfg.capability_config ?? {}) as Record<string, unknown>
        const templateId = String((capabilityConfig.template_entity_id as string) ?? '').trim()
        if (templateId) {
          const known = await loadKnownDocTemplateIds()
          if (!known.has(templateId)) {
            errors.push(
              `stage "${s.key}" runs capability "${slug}" but its action.config.capability_config.template_entity_id "${templateId}" is not an active firm document template — use an exact templateEntityId from get_workflow_context's availableTemplates.`,
            )
          }
        }
      }
    }
  }

  // ESIGN-BLOCK-1 (WP3) — e-sign composes ONLY where a document is signable: an
  // invoke_capability{esignature} stage must IMMEDIATELY follow a document-producing
  // stage whose bound template declares signature.required. Authoring-only, same
  // style as the deprecated-kind and billing checks: existing saved definitions keep
  // validating and running.
  const esignStages = graph.filter((s) => {
    if (s.action?.kind !== 'invoke_capability') return false
    const cfg = (s.action.config ?? {}) as { capability_slug?: string }
    return (cfg.capability_slug ?? '').trim() === 'esignature'
  })
  for (const s of esignStages) {
    // Walk BACK to the document-producing stage this e-sign step signs. Linear graph
    // → at most one predecessor per stage. The e-sign step sends the latest APPROVED
    // version, and approval happens on the review step — so the canonical chain is
    // draft → review_send_document → esign; the walk skips over the produced
    // document's review stage(s), nothing else.
    let producer: Lifecycle[number] | null = null
    let cursor: Lifecycle[number] | undefined = s
    while (cursor) {
      const predecessor: Lifecycle[number] | undefined = graph.find((p) =>
        p.advances_to.some((e) => e.to === cursor!.key),
      )
      if (!predecessor) break
      if (isDocumentProducingStage(predecessor)) {
        producer = predecessor
        break
      }
      if (predecessor.action?.kind !== 'review_send_document') break
      cursor = predecessor
    }
    if (!producer) {
      errors.push(
        `stage "${s.key}" runs the esignature capability but does not follow a document-producing step — an e-sign step goes right after the step that drafts (and reviews) the signable document: invoke_capability{document_generation}, optionally followed by its review_send_document step. Remove the e-sign step, or move it there.`,
      )
      continue
    }
    const predecessor = producer
    const templateIds = producingStageTemplateIds(predecessor)
    if (templateIds.length === 0) {
      errors.push(
        `stage "${s.key}" runs the esignature capability after stage "${predecessor.key}", but that stage binds no document template — bind the drafting stage's template (action.config.capability_config.template_entity_id) and declare signature.required on it before composing an e-sign step.`,
      )
      continue
    }
    const library = await loadDocTemplates()
    const byId = new Map(library.map((t) => [t.templateEntityId, t]))
    const signable = templateIds.some((id) => byId.get(id)?.signature.required === true)
    if (!signable) {
      const named = templateIds
        .map((id) => {
          const t = byId.get(id)
          return t ? `"${t.name}" (${id})` : `"${id}"`
        })
        .join(', ')
      errors.push(
        `stage "${s.key}" runs the esignature capability, but the preceding stage "${predecessor.key}" drafts from ${named}, which does not declare signature.required — this document is unsigned, so an e-sign step cannot follow it. Either declare the signature block on the template (signature: { required: true, signer_roles: [...] } via legal.template.update) or remove the e-sign step.`,
      )
    }
  }

  return { ok: errors.length === 0, errors, warnings }
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
  const validation = await validateProposedLifecycle(ctx, graph, serviceKey)
  if (!validation.ok) {
    throw new Error(`Invalid workflow lifecycle: ${validation.errors.join('; ')}`)
  }

  // BUILDER-UX-3 (P6) — the reasoning-trace conclusion keeps the computed billing
  // read-out (BUILDER-CERT-1 WP1's receipt) even though the card summary no longer
  // restates it: re-appended HERE, in the core write path, so it is server-computed
  // at approve time from the persisted billing — never model prose, never
  // card-visible copy. Best-effort: a readout failure must not block the approve.
  let tracedReasoning = reasoning
  try {
    const readout = await computeBillingReadout(ctx, serviceKey, { graph })
    if (readout) {
      const conclusion = reasoning.conclusion?.trim() || `Authored a workflow for ${serviceKey}.`
      tracedReasoning = {
        ...reasoning,
        conclusion: `${conclusion} ${formatBillingReadout(readout)}`,
      }
    }
  } catch {
    // trace keeps the model's conclusion alone
  }

  // The write is AS THE AGENT, not the attorney — the trace, the action source, and
  // the configuration_change all attribute the authoring to the Claude agent actor,
  // exactly like generateDraft.runDraftGeneration.
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }
  const reasoningTraceId = await persistReasoningTrace(agentCtx, serviceKey, graph, tracedReasoning)

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
