import { withActionContext, type ActionContext } from '@exsto/substrate'
import { parseStatesToGraph } from '../lifecycle/binding.js'
import { allowedTransitions, attorneyLabel, stageByKey } from '../lifecycle/resolve.js'
import type { Lifecycle, LifecycleEdge } from '../lifecycle/types.js'

// TASK-QUEUE-2 — workflow/matter STEPS blocked on the attorney, firm-wide.
// Step state is persisted (ADR 0045): one workflow_instance per matter carries
// the current_state; the graph lives in the bound workflow_definition.states
// (honoring a per-instance states_override). A step is "on the attorney" when
// there is an attorney-gated outgoing transition from the matter's current
// state — allowedTransitions(graph, current, ['attorney']) — that is NOT already
// surfaced by another Task Queue source. This module is the firm-wide reader;
// the pure gate/dedup logic below is DB-free and unit-tested against a synthetic
// graph. Legacy matters with NO workflow_instance carry no persisted step state
// and are simply excluded (they have nothing to interpret).

// Attorney `via` actions that another source already lists, so surfacing them
// here too would double-list the same task:
//   • 'draft.approve' — the pending draft it approves is a Document Review row
//     (legal.draft.list_pending → normalizeDocumentReviewTask).
//   • any 'esign*' action — the send/sign is an E-Sign row
//     (legal.esign.awaiting_me → normalizeEsignTask). In practice the e-sign
//     STEP's own outgoing edge is a SYSTEM gate (on esign.completed), so it never
//     appears in allowedTransitions(['attorney']) and this esign guard is
//     belt-and-suspenders for any hand-authored attorney-gated e-sign edge.
// Residual overlap note: an `invoke_capability{esignature}` step (older authored
// graphs) also advances on a system edge, so it is likewise never attorney-gated
// here — no double-listing. If a future authored graph introduces an
// attorney-gated e-sign action under a different `via`, extend this predicate.
function isSurfacedElsewhere(edge: LifecycleEdge): boolean {
  const via = (edge.via ?? '').trim()
  if (via === 'draft.approve') return true
  if (via.startsWith('esign')) return true
  return false
}

// PURE — the attorney transitions out of `currentState` that this Task Queue
// should surface as a Workflow Step: attorney-gated, minus the ones another
// source already lists (see isSurfacedElsewhere). An instance qualifies iff this
// returns ≥1 edge. DB-free so it is unit-testable against a synthetic graph.
export function surfacedAttorneyTransitions(
  graph: Lifecycle,
  currentState: string,
): LifecycleEdge[] {
  return allowedTransitions(graph, currentState, ['attorney']).filter(
    (e) => !isSurfacedElsewhere(e),
  )
}

// PURE — the "waiting since" timestamp for the matter's current step: the `at`
// of the LAST state_history entry that landed in `currentState` (append-only, so
// the last matching entry is the most recent arrival), falling back to a supplied
// default (the instance started_at / matter created_at) when history carries no
// timestamp for it.
export function currentStateSince(
  stateHistory: unknown,
  currentState: string,
  fallback: string,
): string {
  if (!Array.isArray(stateHistory)) return fallback
  let at: string | null = null
  for (const raw of stateHistory) {
    if (raw && typeof raw === 'object') {
      const entry = raw as { state?: unknown; at?: unknown }
      if (entry.state === currentState && typeof entry.at === 'string') at = entry.at
    }
  }
  return at ?? fallback
}

// One firm-wide row: a matter parked on an attorney-gated step.
export interface WorkflowStepAwaitingAttorney {
  matterEntityId: string
  matterNumber: string
  clientName: string | null
  // The current stage's attorney-facing label (fallback: the stage key).
  title: string
  // ISO timestamp the matter arrived on the current step.
  since: string
}

interface WorkflowStepRow {
  matter_entity_id: string
  current_state: string
  state_history: unknown
  states_override: unknown
  definition_states: unknown
  matter_number: string | null
  client_name: string | null
  started_at: string
  matter_created_at: string | null
}

// Every active matter whose current step is blocked on an attorney action,
// firm-wide. ONE tenant-scoped query joins the active workflow_instances to
// their bound workflow_definition (for states), the matter entity (name =
// matterNumber, created_at fallback), and the client name via client_of; the
// graph is then interpreted in-memory with the shared pure resolver. A
// per-instance states_override supersedes the definition's states for that
// matter (loadWorkflow / getWorkflowInstanceForMatter precedent).
export async function listWorkflowStepsAwaitingAttorney(
  ctx: ActionContext,
): Promise<WorkflowStepAwaitingAttorney[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowStepRow>(
      `SELECT
         wi.subject_entity_id AS matter_entity_id,
         wi.current_state,
         wi.state_history,
         wi.states_override,
         wd.states AS definition_states,
         m.name AS matter_number,
         to_char(wi.started_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS started_at,
         to_char(m.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS matter_created_at,
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = r.source_entity_id
            JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = wi.subject_entity_id AND rkd.kind_name = 'client_of'
              AND (r.valid_to IS NULL OR r.valid_to > now())
            ORDER BY a2.valid_from DESC
            LIMIT 1) AS client_name
       FROM workflow_instance wi
       JOIN workflow_definition wd ON wd.tenant_id = wi.tenant_id AND wd.id = wi.workflow_definition_id
       LEFT JOIN entity m ON m.tenant_id = wi.tenant_id AND m.id = wi.subject_entity_id
      WHERE wi.tenant_id = $1
        AND wi.status = 'active'
        AND wi.subject_entity_id IS NOT NULL`,
      [ctx.tenantId],
    )

    const out: WorkflowStepAwaitingAttorney[] = []
    for (const row of res.rows) {
      // states_override (when a non-empty array) supersedes the definition graph
      // for this matter only — same precedence as loadWorkflow.
      const override = parseStatesToGraph(row.states_override)
      const graph: Lifecycle =
        override.length > 0 ? override : parseStatesToGraph(row.definition_states)
      if (graph.length === 0) continue

      const transitions = surfacedAttorneyTransitions(graph, row.current_state)
      if (transitions.length === 0) continue

      const stage = stageByKey(graph, row.current_state)
      const title = stage ? attorneyLabel(stage) : row.current_state
      const since = currentStateSince(
        row.state_history,
        row.current_state,
        row.started_at ?? row.matter_created_at ?? '',
      )
      out.push({
        matterEntityId: row.matter_entity_id,
        matterNumber: row.matter_number ?? '',
        clientName: row.client_name ?? null,
        title,
        since,
      })
    }
    return out
  })
}
