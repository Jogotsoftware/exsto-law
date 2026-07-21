// Step-action catalog (PR3) — the closed set of what a workflow step DOES, and the
// guardrail the builder, the task/workflow library, and the AI all compose from.
// The TYPES (StepActionKind, StepAction, DocumentRef) live in types.ts because
// LifecycleStage references them; this file holds the catalog VALUES + helpers.
// New capabilities are added HERE (a spec) AND in the executor — never by free-form
// AI output. `defaultGate` is what a new step of this kind gets in the builder;
// `blocking:false` marks an informational step that never holds the matter up.
import type { GateKind, StepActionKind } from './types.js'

export interface StepActionSpec {
  kind: StepActionKind
  label: string
  description: string
  defaultGate: GateKind
  blocking: boolean
  // CAPABILITY-UNIFY-1 (WP5): a deprecated kind stays RUNNABLE (existing definitions
  // keep working) but is NOT offered for NEW authoring — the builder composes its
  // replacement instead. `generate_document` is deprecated in favor of the
  // `document_generation` capability wired as an invoke_capability step.
  deprecated?: boolean
}

export const STEP_ACTION_CATALOG: StepActionSpec[] = [
  {
    kind: 'view_intake',
    label: 'Client intake',
    description:
      'Client fills the intake questionnaire; the attorney opens the step to read the answers.',
    defaultGate: 'client',
    blocking: true,
  },
  {
    kind: 'view_consultation',
    label: 'Client consultation',
    description:
      'The consultation meeting. Informational — opening the step shows the Granola transcript summary; it never blocks the matter.',
    defaultGate: 'attorney',
    blocking: false,
  },
  {
    kind: 'generate_document',
    label: 'Generate document',
    description:
      "DEPRECATED for new authoring — produce a document draft from the step's document template(s) + the intake answers. New drafting steps are authored as an invoke_capability stage running the `document_generation` capability (one block, per-step template). Kept runnable so existing definitions keep working.",
    defaultGate: 'automatic',
    blocking: true,
    deprecated: true,
  },
  {
    kind: 'review_send_document',
    label: 'Review & send document',
    description:
      'Attorney reviews the draft, approves it, and sends it to the client — from one window.',
    defaultGate: 'attorney',
    blocking: true,
  },
  {
    kind: 'approve_send_invoice',
    label: 'Approve & send invoice',
    description: 'Attorney approves the invoice; it is then sent to the client automatically.',
    defaultGate: 'attorney',
    blocking: true,
  },
  {
    kind: 'await_payment',
    label: 'Await payment',
    description: 'Hold the matter until the invoice is marked paid.',
    defaultGate: 'system',
    blocking: true,
  },
  {
    kind: 'manual_task',
    label: 'Manual task',
    description:
      'A free-form to-do the attorney checks off. Use for anything outside the standard steps.',
    defaultGate: 'attorney',
    blocking: true,
  },
  {
    kind: 'complete_matter',
    label: 'Complete matter',
    description: 'Close the matter. Terminal step.',
    defaultGate: 'system',
    blocking: false,
  },
  {
    // ADR 0046 — the one OPEN-ENDED step kind: it runs a registered platform
    // capability resolved from the capability registry at run time (which capability
    // + its config live on the stage's StepAction.config as a CapabilityStepConfig).
    // The DEFAULT gate here is a placeholder; the real gate is the invoked
    // capability's own `default_gate` (attorney for a review, client for a
    // materials request), which the builder writes onto the stage's edge.
    kind: 'invoke_capability',
    label: 'Run a platform capability',
    description:
      "Run one of the platform's registered, step-invocable capabilities (e.g. AI document review, request client materials) as a workflow step — the capability produces its outputs and the matter waits at the capability's gate.",
    defaultGate: 'attorney',
    blocking: true,
  },
  {
    // ESIGN-UNIFY-1 ES-4 (design §7) — the workflow-embedded e-sign step. Sits
    // right after the approve step for a SIGNABLE document kind (the builder
    // auto-adds it — lifecycle/esignStage.ts): opening the step shows the
    // auto-built envelope (approved version + template-role-resolved recipients
    // + pre-placed fields) with ONE primary action, Review & send. The send is
    // the step's own embedded action (never a bare Continue — the #442
    // doctrine); the stage then HOLDS the matter until every signer signs: its
    // system edge fires on esign.completed via the existing lifecycle dispatch
    // in handlers/esign.ts (the #320 loop). esign.sent marks the step's own
    // action complete (the card reads "sent — awaiting signatures").
    kind: 'esign',
    label: 'eSign',
    description:
      "Send the step's approved document for e-signature: the envelope is auto-built from the approved version, the template's signer roles, and its pre-placed fields — the attorney reviews and sends in place. The matter then waits until all signers have signed (esign.completed).",
    defaultGate: 'system',
    blocking: true,
  },
]

export const STEP_ACTION_KINDS: StepActionKind[] = STEP_ACTION_CATALOG.map((s) => s.kind)

export function stepActionSpec(kind: StepActionKind): StepActionSpec | undefined {
  return STEP_ACTION_CATALOG.find((s) => s.kind === kind)
}

// CAPABILITY-UNIFY-1 (WP5) — the AUTHORABLE subset: the catalog minus deprecated
// kinds. The full STEP_ACTION_KINDS stays the runtime/validation vocabulary (existing
// definitions with a deprecated kind keep validating and running); the authoring
// surface (get_workflow_context's offered catalog + propose_workflow's action.kind
// enum) offers only these, so NEW workflows can't be authored with a deprecated step.
export const AUTHORABLE_STEP_ACTION_CATALOG: StepActionSpec[] = STEP_ACTION_CATALOG.filter(
  (s) => !s.deprecated,
)

export const AUTHORABLE_STEP_ACTION_KINDS: StepActionKind[] = AUTHORABLE_STEP_ACTION_CATALOG.map(
  (s) => s.kind,
)

export function isDeprecatedStepActionKind(kind: StepActionKind): boolean {
  return STEP_ACTION_CATALOG.find((s) => s.kind === kind)?.deprecated === true
}
