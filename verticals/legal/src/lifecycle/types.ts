// Matter-lifecycle types (ADR 0045). A service's lifecycle is an ordered stage
// graph stored in workflow_definition.states; each stage carries its outgoing
// transitions. Shapes are snake_case to match the rest of the service config that
// lives in workflow_definition (route, intake_form_id, …) — the jsonb is the
// canonical form, so there is no camelCase transform layer.
//
// PR2 (shadow): these types + the resolver + the derivation are read-only and not
// yet wired into the engine. Nothing reads states until PR3.

// Who or what advances an edge. `route` (auto/manual) is no longer a special case:
// it is whether the drafting edge is `automatic` or `attorney` (ADR 0045 §2).
export type GateKind =
  | 'automatic' // the worker/system advances when the edge condition holds
  | 'attorney' // an attorney action advances it (e.g. draft.approve)
  | 'client' // a client action advances it (e.g. booking.create, sign)
  | 'system' // an external callback advances it (e.g. esign.completed)

export const GATE_KINDS: readonly GateKind[] = ['automatic', 'attorney', 'client', 'system']

// One outgoing transition. `via` names the action that fires it (attorney/client
// gates); `on` names the event/condition it waits for (automatic/system gates);
// `when` is an optional guard predicate key. Exactly the metadata the engine needs
// to decide, in PR3, whether a transition may fire and who fires it.
export interface LifecycleEdge {
  to: string
  gate: GateKind
  via?: string // action kind name (attorney/client gates)
  on?: string // event kind / condition name (automatic/system gates)
  when?: string // optional guard predicate key
  condition?: Record<string, unknown> // PR3 (reserved): branching guard — not implemented yet
}

// ── Step-action layer (PR3) — what a stage's matter-Workflow pop-up DOES ─────────
// `action` names the window/behavior; the closed CATALOG (catalog.ts) is the only
// set the builder, the task library, and the AI may compose from. These fields are
// additive + optional, so the PR2 shadow resolver, derive(), and the equality
// invariant are unaffected.
export type StepActionKind =
  | 'view_intake' // read-only: show the client's intake answers
  | 'view_consultation' // read-only: show the Granola consultation summary
  | 'generate_document' // produce a document draft from the step's template(s)
  | 'review_send_document' // attorney: review → approve → send to client (one window)
  | 'approve_send_invoice' // attorney: approve the invoice → auto-send to client
  | 'await_payment' // system: hold until the invoice is paid
  | 'manual_task' // attorney: a free-form to-do with a done check
  | 'complete_matter' // terminal: close the matter
  | 'invoke_capability' // run a registered, step-invocable platform capability (ADR 0046)
  | 'esign' // ESIGN-UNIFY-1 ES-4: confirm-and-send the approved doc for e-signature, hold until esign.completed

// The config an `invoke_capability` step carries: WHICH registered capability to run
// (by its stable registry slug) and the attorney's standing instructions for it, set
// once at build time and validated against the capability's `config_schema`. This is
// the ONLY step kind whose behavior is resolved from the capability registry at run
// time rather than a hardcoded executor branch — new runnable abilities are registry
// entries (a `step_invocable` capability + a handler), never new step kinds.
export interface CapabilityStepConfig {
  capability_slug: string
  // Attorney standing instructions (e.g. the review rubric, the materials to request).
  // Shape is capability-specific; validated against the capability's config_schema.
  capability_config?: Record<string, unknown>
}

// ESIGN-UNIFY-1 ES-4 (design §7) — the config an `esign` step carries: WHICH
// document kind's approved version it sends. Recipients/roles are NOT stored
// here — they resolve at open time from the service's template e-sign config
// (transitions.document_templates.esign[document_kind], the ES-3 store) via
// esignPrefill, so a template edit never strands a stale copy in the graph.
export interface EsignStepConfig {
  document_kind?: string
}

export interface StepAction {
  kind: StepActionKind
  config?: Record<string, unknown>
}

// A document template a step uses — from the firm template library (legal.template.*)
// by entity id, or by document kind for a service-bound template. A document-centric
// action makes the document the WHOLE task; any step may also carry documents as PART.
export interface DocumentRef {
  templateEntityId?: string
  docKind?: string
  label?: string
}

export interface LifecycleStage {
  key: string // == the matter_status value written today
  label: string // attorney-facing
  client_label?: string // client-portal-facing (falls back to label)
  entry?: boolean // the stage a matter starts in
  terminal?: boolean // no outgoing transitions; the matter is done
  blocking?: boolean // PR3: false = informational step that never holds the matter (e.g. consultation)
  action?: StepAction // PR3: what this step's matter-Workflow pop-up does (catalog kind)
  documents?: DocumentRef[] // PR3: template(s) this step produces/handles
  advances_to: LifecycleEdge[]
}

// The whole graph: an ordered list of stages. Order is display order; reachability
// is by edges, not array position.
export type Lifecycle = LifecycleStage[]

export interface LifecycleValidation {
  ok: boolean
  errors: string[]
}
