// Workflow builder catalog MCP tool (ADR 0045, PR4b) — the read tool the
// service-editor Workflow builder loads its palette from, so the builder is
// data-driven from the SINGLE server-side catalog and the guardrail stays
// server-side: the closed set of what a step may DO (STEP_ACTION_CATALOG), the
// closed set of who/what advances an edge (GATE_KINDS), the per-gate transition
// vocabulary, and the step-invocable platform capabilities live in verticals/legal
// and are surfaced here, never re-declared in app code. Attorney-only — like the
// other service-library/lifecycle tools it is deliberately NOT in
// CLIENT_PORTAL_TOOLS (clientPolicy.ts is default-deny, so leaving it out is
// sufficient).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  STEP_ACTION_CATALOG,
  GATE_KINDS,
  GATE_TRANSITION_VOCABULARY,
  buildInvokeCapabilityStepTemplate,
} from '../../index.js'
import type { StepActionSpec, GateKind, StepAction } from '../../index.js'
import { listCapabilities, type CapabilitySpec } from '../../queries/capabilities.js'
import type { ActionContext } from '@exsto/substrate'

// The completion token a capability's stage advances on once the capability
// finishes, where one is known (the system `on` the runtime dispatches — see
// GATE_TRANSITION_VOCABULARY). Server-side so the builder can seed a REAL token
// instead of a dead default; slugs without a known completion event get '' and the
// attorney picks from the vocabulary.
const CAPABILITY_COMPLETION_TOKENS: Record<string, string> = {
  esignature: 'esign.completed',
}

// A capability as a palette entry: everything the visual builder needs to seed a
// working invoke_capability step, generated from the capability's own spec (ONE
// config_schema — the same one the AI authoring path and the validator read).
export interface PaletteCapability {
  slug: string
  label: string
  description: string
  defaultGate: GateKind
  seedAction: StepAction
  suggestedTrigger: string
}

const catalogTool: Tool<
  Record<string, never>,
  {
    actions: StepActionSpec[]
    gates: readonly GateKind[]
    gateTransitions: typeof GATE_TRANSITION_VOCABULARY
    capabilities: PaletteCapability[]
  }
> = {
  name: 'legal.workflow.catalog',
  description:
    'Get the workflow-builder palette: the closed catalog of step actions (kind, label, description, defaultGate, blocking), the closed set of edge gates, the per-gate transition vocabulary (the exact via/on tokens the runtime advances on, with plain-language labels), and the step-invocable platform capabilities (each with a ready-to-use invoke_capability seed action and, where known, the completion token its stage advances on). The service-editor Workflow builder composes a service lifecycle from these; the catalog is the server-side guardrail (steps, gates, capabilities, and advance tokens are a closed set, not free-form).',
  mode: 'read',
  // The action/gate/transition surface is a pure constant; the capabilities group is
  // the tenant's registry (a read) — same filter the AI authoring context applies
  // (workflowAuthoring.loadWorkflowAuthoringContext), so the two palettes offer the
  // same set.
  handler: async (ctx: ActionContext) => {
    const capabilities: PaletteCapability[] = (await listCapabilities(ctx))
      .filter((c) => c.status === 'available' && c.spec.step_invocable === true)
      // A capability can opt out of authoring (spec.authorable === false, e.g. one
      // that only runs inside a fixed pipeline). Read defensively: the flag is newer
      // than the CapabilitySpec type and older stored specs simply omit it.
      .filter((c) => (c.spec as CapabilitySpec & { authorable?: boolean }).authorable !== false)
      .map((c) => ({
        slug: c.slug,
        label: c.spec.name,
        description: c.spec.purpose ?? '',
        defaultGate: (c.spec.default_gate ?? 'attorney') as GateKind,
        seedAction: buildInvokeCapabilityStepTemplate({ slug: c.slug, spec: c.spec }).action,
        suggestedTrigger: CAPABILITY_COMPLETION_TOKENS[c.slug] ?? '',
      }))
    return {
      actions: STEP_ACTION_CATALOG,
      gates: GATE_KINDS,
      gateTransitions: GATE_TRANSITION_VOCABULARY,
      capabilities,
    }
  },
}

registerTool(catalogTool)
