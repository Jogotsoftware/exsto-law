// Workflow-authoring chat tools (PR5) — two ClientTools the attorney's Claude turn
// registers ALONGSIDE produce_document, mirroring buildProduceDocumentTool exactly:
//   • buildWorkflowContextTool — READ-ONLY: the model calls it to learn the closed
//     catalog (what a step may do + who advances an edge), the service's CURRENT
//     lifecycle, and the firm's available document templates. It composes ONLY from
//     this; it never invents step kinds, gates, or document references.
//   • buildProposeWorkflowTool — CAPTURE-ONLY: the model calls it with a complete
//     proposed graph. It is validated (structural + closed action-kind vocab +
//     linear-only + referenced template ids must exist) and CAPTURED into a per-turn
//     proposals array the caller surfaces as an inline approval card. It writes
//     NOTHING — the live version write happens only when the attorney approves
//     (decision 1). The ack tells the model not to repeat the graph in prose.
//
// The input_schema constrains action.kind to the AUTHORABLE catalog (enum =
// AUTHORABLE_STEP_ACTION_KINDS — the closed catalog minus deprecated kinds like
// generate_document) and gate to GATE_KINDS, so the guardrail is on the tool surface
// as well as in the validator.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { AUTHORABLE_STEP_ACTION_KINDS, GATE_KINDS, type Lifecycle } from '../lifecycle/index.js'
import { loadWorkflowAuthoringContext, validateProposedLifecycle } from './workflowAuthoring.js'
import { computeBillingReadout, formatBillingReadout } from './billingReadout.js'
import { getServiceLifecycle } from './serviceLifecycle.js'

// Key-order-stable stringify so two semantically identical stages never read as
// "changed" just because the model emitted their keys in a different order.
function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v as Record<string, unknown>)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

// BUILDER-CERT-1 (WP3) — the COMPUTED change read-out. A revision card must state
// what actually changed vs the service's LIVE workflow, computed here — never the
// model's own "only X changed" claim (a certification drive caught that claim being
// false while the summary asserted it). Null when the service has no saved graph yet
// (first authoring — everything is new, there is nothing to diff against).
export function describeGraphChanges(
  current: Lifecycle | null,
  proposed: Lifecycle,
): string | null {
  if (!current || current.length === 0) return null
  const cur = new Map(current.map((s) => [s.key, stableJson(s)]))
  const nxt = new Map(proposed.map((s) => [s.key, stableJson(s)]))
  const added = [...nxt.keys()].filter((k) => !cur.has(k))
  const removed = [...cur.keys()].filter((k) => !nxt.has(k))
  const changed = [...nxt.keys()].filter((k) => cur.has(k) && cur.get(k) !== nxt.get(k))
  if (!added.length && !removed.length && !changed.length) {
    return 'Computed vs the live workflow: no changes (identical graph).'
  }
  const parts: string[] = []
  if (added.length) parts.push(`adds ${added.join(', ')}`)
  if (removed.length) parts.push(`removes ${removed.join(', ')}`)
  if (changed.length) parts.push(`modifies ${changed.join(', ')}`)
  return `Computed vs the live workflow: ${parts.join('; ')}.`
}

// A workflow proposal captured this turn — the proposed graph plus the model's
// reasoning. The chat surfaces it as an inline card; the attorney approves it, which
// posts the approve route (the only place a live write happens). Mirrors
// ProducedDocument: a captured, not-yet-persisted deliverable the attorney acts on.
export interface WorkflowProposal {
  serviceKey: string
  graph: Lifecycle
  summary: string
  confidence: number
}

const WORKFLOW_CONTEXT_TOOL_DEF = {
  name: 'get_workflow_context',
  description:
    "Get everything needed to PROPOSE or edit a workflow for an existing service: the closed catalog of step actions you may use (kind, label, description, defaultGate, blocking), the closed set of edge gates, the service's CURRENT lifecycle graph (null if none authored yet), the firm's available document templates you may attach to steps, `stepLibrary` — the firm's SAVED, reusable workflow steps (each with a name, description, and a one-line stage summary) — and `invocableCapabilities` — real platform abilities a step can RUN (e.g. AI document review). SEARCH `stepLibrary` FIRST: if a saved step matches one you need, REUSE it (mirror its action + gate) rather than composing an identical step from scratch. For a step that should run one of `invocableCapabilities`, COPY that capability's `stepTemplate` VERBATIM as the stage's `action` (same two keys, same nesting) and only replace the `<…>` placeholder values inside `capability_config` with the real content — never rename `capability_slug`, never move a config value out of `capability_config`, never invent different keys. Compose a workflow ONLY from these — never invent a step kind, a gate, or a document template id. Call this FIRST whenever the attorney asks you to build, add to, or change a service workflow.",
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description:
          "The kind_name of the EXISTING service whose workflow you are authoring (e.g. 'nc_single_member_llc_formation').",
      },
    },
    required: ['service_key'],
    additionalProperties: false,
  },
}

// Read-only context tool. Returns the catalog + current graph + available templates
// as JSON for the model. No capture, no write.
export function buildWorkflowContextTool(ctx: ActionContext): ClientTool {
  return {
    definition: WORKFLOW_CONTEXT_TOOL_DEF,
    name: 'get_workflow_context',
    run: async (raw) => {
      const args = (raw ?? {}) as { service_key?: string }
      const serviceKey = (args.service_key ?? '').trim()
      if (!serviceKey) return 'No service_key was provided, so no workflow context could be loaded.'
      const context = await loadWorkflowAuthoringContext(ctx, serviceKey)
      return JSON.stringify(context)
    },
  }
}

// The step-action / gate / document shape the model must produce — action.kind and
// gate are enums (closed catalog), documents reference EXISTING templates by id.
const STAGE_SCHEMA = {
  type: 'object' as const,
  properties: {
    key: { type: 'string' as const, description: 'A stable snake_case stage key.' },
    label: { type: 'string' as const, description: 'Attorney-facing step name.' },
    client_label: {
      type: 'string' as const,
      description: 'Optional client-portal-facing name (falls back to label).',
    },
    entry: { type: 'boolean' as const, description: 'True for the one starting stage.' },
    terminal: {
      type: 'boolean' as const,
      description: 'True for the final stage; a terminal stage has no outgoing edges.',
    },
    blocking: {
      type: 'boolean' as const,
      description: 'False marks an informational step that never holds the matter up.',
    },
    action: {
      type: 'object' as const,
      description: 'What this step does — its kind MUST be from the closed catalog.',
      properties: {
        kind: { type: 'string' as const, enum: AUTHORABLE_STEP_ACTION_KINDS },
        config: {
          type: 'object' as const,
          description:
            'For kind="invoke_capability" ONLY: copy the target capability\'s `stepTemplate.action.config` from get_workflow_context\'s `invocableCapabilities` VERBATIM (keys are always exactly `capability_slug` and `capability_config`) — never a bare `slug`, never a flattened field. Every other kind ignores config.',
          additionalProperties: true,
        },
      },
      required: ['kind'],
      additionalProperties: false,
    },
    documents: {
      type: 'array' as const,
      description:
        'Document templates this step handles — reference EXISTING firm templates by templateEntityId (from get_workflow_context), or a service-bound docKind.',
      items: {
        type: 'object' as const,
        properties: {
          templateEntityId: { type: 'string' as const },
          docKind: { type: 'string' as const },
          label: { type: 'string' as const },
        },
        additionalProperties: false,
      },
    },
    advances_to: {
      type: 'array' as const,
      description:
        'Outgoing transition(s). LINEAR ONLY: a non-terminal stage has EXACTLY ONE edge; a terminal stage has none.',
      items: {
        type: 'object' as const,
        properties: {
          to: { type: 'string' as const, description: 'The next stage key.' },
          gate: {
            type: 'string' as const,
            enum: GATE_KINDS as unknown as string[],
            description: 'Who/what advances this edge.',
          },
          via: {
            type: 'string' as const,
            description:
              'For attorney/client gates: the EXACT advance token from get_workflow_context\'s `gateTransitions[gate].options[].token` (e.g. "document.upload", "draft.approve") — NEVER prose. The runtime matches on it verbatim; a made-up token means the step never advances.',
          },
          on: {
            type: 'string' as const,
            description:
              'For system gates: the EXACT event token from `gateTransitions.system.options[].token` (e.g. "invoice.paid"). Automatic gates are free-form. Never invent a token.',
          },
        },
        required: ['to', 'gate'],
        additionalProperties: false,
      },
    },
  },
  required: ['key', 'label', 'action', 'advances_to'],
  additionalProperties: false,
}

const PROPOSE_WORKFLOW_TOOL_DEF = {
  name: 'propose_workflow',
  description:
    'Propose a complete workflow lifecycle for an existing service for the attorney to review and APPROVE. This does NOT save anything — it captures the proposal so the attorney sees it as an approval card; the live version is written only when they approve. The graph must be LINEAR (each non-terminal stage has exactly one outgoing edge), have exactly one entry stage and one reachable terminal stage, use ONLY step-action kinds and gates from get_workflow_context, and reference documents ONLY by templateEntityId from the firm library. Call this ONLY when you have a complete, valid graph; put the graph ONLY in this tool call, not in your chat reply.',
  input_schema: {
    type: 'object',
    properties: {
      service_key: {
        type: 'string',
        description: 'The kind_name of the existing service this workflow is for.',
      },
      graph: {
        type: 'array',
        description: 'The ordered stage graph (display order). Linear; one entry, one terminal.',
        items: STAGE_SCHEMA,
      },
      summary: {
        type: 'string',
        description:
          'A one-paragraph plain-language summary of WHY this workflow — what changed vs the current one and the reasoning. Shown to the attorney and recorded as the reasoning trace on approve.',
      },
      confidence: {
        type: 'number',
        description: 'Your honest confidence in this proposal, 0–1 (never 1.0).',
      },
    },
    required: ['service_key', 'graph', 'summary'],
    additionalProperties: false,
  },
}

// WP3 (WORKFLOW-AUTHORING-1) — a proposal that keeps failing validation must STOP,
// not loop: with good errors (diagnoseCapabilityStepConfig et al. name the exact
// expected key/path) one correction should land it, so a SECOND failure this turn
// is treated as unrecoverable for the turn — the model is told to stop calling this
// tool and report the failure honestly instead of guessing again. `failedAttempts`
// (one entry per failed call, in order) is read back by the caller after the model
// loop: if it's non-empty and nothing was ever captured, the caller appends an
// honest-failure notice so a stuck turn can never render as silent success.
const MAX_FAILED_PROPOSE_ATTEMPTS = 2

// Build the propose_workflow tool for this turn. Its run() validates the graph (the
// SAME checks the write path applies) and, on success, CAPTURES it into `captured`
// (read back by the caller to surface the approval card) — it never writes. On a
// validation failure it records the errors into `failedAttempts` and returns them
// so the model can fix and re-propose ONCE; beyond `MAX_FAILED_PROPOSE_ATTEMPTS` it
// refuses to re-validate and tells the model to stop.
export function buildProposeWorkflowTool(
  ctx: ActionContext,
  captured: WorkflowProposal[],
  failedAttempts: string[] = [],
): ClientTool {
  return {
    definition: PROPOSE_WORKFLOW_TOOL_DEF,
    name: 'propose_workflow',
    run: async (raw) => {
      if (failedAttempts.length >= MAX_FAILED_PROPOSE_ATTEMPTS) {
        return `propose_workflow has already failed ${failedAttempts.length} times this turn — STOP calling it again. Tell the attorney plainly that you could not compose a valid workflow and summarize what was blocking it (from the errors above); do not apologize repeatedly or claim a workflow exists.`
      }
      const args = (raw ?? {}) as {
        service_key?: string
        graph?: Lifecycle
        summary?: string
        confidence?: number
      }
      const serviceKey = (args.service_key ?? '').trim()
      const graph = Array.isArray(args.graph) ? args.graph : null
      if (!serviceKey || !graph) {
        return 'A service_key and a graph are both required to propose a workflow; nothing was captured.'
      }
      const validation = await validateProposedLifecycle(ctx, graph, serviceKey)
      if (!validation.ok) {
        const errorText = validation.errors.join('; ')
        failedAttempts.push(errorText)
        const attemptsLeft = MAX_FAILED_PROPOSE_ATTEMPTS - failedAttempts.length
        const retryInstruction =
          attemptsLeft > 0
            ? 'Fix these and call propose_workflow AGAIN — NEVER paste the artifact into your prose reply (prose has no Approve button).'
            : `This was your last allowed attempt this turn (${MAX_FAILED_PROPOSE_ATTEMPTS} failed) — if you call propose_workflow again it will be refused. Fix these NOW and call it exactly once more, or stop and report the failure honestly.`
        return `The proposed workflow is not valid and was NOT captured. ${retryInstruction} Errors: ${errorText}`
      }
      const confidence =
        typeof args.confidence === 'number' && Number.isFinite(args.confidence)
          ? Math.min(0.99, Math.max(0, args.confidence))
          : 0.7
      // BUILDER-CERT-1 (WP1) — every workflow card STATES the total per-matter charge
      // the composed billing produces (computed from the service's declared fees, not
      // trusted from the model), so a double-bill is deliberate and visible.
      const readout = await computeBillingReadout(ctx, serviceKey, { graph })
      const billingLine = readout ? ` ${formatBillingReadout(readout)}` : ''
      const warningText = validation.warnings.length
        ? ` WARNINGS (non-blocking — the card shows them; relay them to the attorney in one short line): ${validation.warnings.join('; ')}`
        : ''
      // WP3 — computed change read-out vs the LIVE workflow: the card states what a
      // revision actually changes; a false "only X changed" summary can't survive it.
      const currentGraph = (await getServiceLifecycle(ctx, serviceKey))?.graph ?? null
      const changeLine = describeGraphChanges(currentGraph, graph)
      const changeText = changeLine ? ` ${changeLine}` : ''
      captured.push({
        serviceKey,
        graph,
        summary:
          ((args.summary ?? '').trim() || `Proposed workflow for ${serviceKey}.`) +
          billingLine +
          changeText +
          (validation.warnings.length ? ` ⚠ ${validation.warnings.join(' ⚠ ')}` : ''),
        confidence,
      })
      return `The proposed workflow for "${serviceKey}" (${graph.length} steps) is shown to the attorney as an approval card; it is NOT saved until they approve.${billingLine}${changeText}${warningText} The card renders BELOW your reply (never say "above"). If you already wrote a framing sentence this turn, reply with an EMPTY message — otherwise ONE short sentence; NEVER repeat the workflow steps in prose.`
    },
  }
}
