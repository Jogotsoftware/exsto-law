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
    description: "Produce a document draft from the step's document template(s) + the intake answers.",
    defaultGate: 'automatic',
    blocking: true,
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
]

export const STEP_ACTION_KINDS: StepActionKind[] = STEP_ACTION_CATALOG.map((s) => s.kind)

export function stepActionSpec(kind: StepActionKind): StepActionSpec | undefined {
  return STEP_ACTION_CATALOG.find((s) => s.kind === kind)
}
