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
}

export interface LifecycleStage {
  key: string // == the matter_status value written today
  label: string // attorney-facing
  client_label?: string // client-portal-facing (falls back to label)
  entry?: boolean // the stage a matter starts in
  terminal?: boolean // no outgoing transitions; the matter is done
  advances_to: LifecycleEdge[]
}

// The whole graph: an ordered list of stages. Order is display order; reachability
// is by edges, not array position.
export type Lifecycle = LifecycleStage[]

export interface LifecycleValidation {
  ok: boolean
  errors: string[]
}
