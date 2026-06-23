// Workflow builder catalog MCP tool (ADR 0045, PR4b) — the read tool the
// service-editor Workflow builder loads its palette from, so the builder is
// data-driven from the SINGLE server-side catalog and the guardrail stays
// server-side: the closed set of what a step may DO (STEP_ACTION_CATALOG) and the
// closed set of who/what advances an edge (GATE_KINDS) live in verticals/legal and
// are surfaced here, never re-declared in app code. This is a READ tool over a
// constant; it touches no substrate state. Attorney-only — like the other
// service-library/lifecycle tools it is deliberately NOT in CLIENT_PORTAL_TOOLS
// (clientPolicy.ts is default-deny, so leaving it out is sufficient).
import { registerTool, type Tool } from '@exsto/mcp-tools'
import { STEP_ACTION_CATALOG, GATE_KINDS } from '../../index.js'
import type { StepActionSpec, GateKind } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const catalogTool: Tool<
  Record<string, never>,
  { actions: StepActionSpec[]; gates: readonly GateKind[] }
> = {
  name: 'legal.workflow.catalog',
  description:
    'Get the workflow-builder palette: the closed catalog of step actions (kind, label, description, defaultGate, blocking) and the closed set of edge gates. The service-editor Workflow builder composes a service lifecycle from these; the catalog is the server-side guardrail (steps and gates are a closed set, not free-form).',
  mode: 'read',
  // Pure constant surface — no substrate read. ctx is accepted to match the Tool
  // signature; the catalog is identical for every tenant.
  handler: async (_ctx: ActionContext) => ({
    actions: STEP_ACTION_CATALOG,
    gates: GATE_KINDS,
  }),
}

registerTool(catalogTool)
