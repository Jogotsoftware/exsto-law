// Lifecycle BINDING resolution (ADR 0045, PR3 read side). Pure reads — no writes.
// A service's runnable lifecycle lives in workflow_definition.states (the canonical
// jsonb stage graph). These helpers turn a service key into the bound, active graph,
// resolve a specific bound version, and find a matter's running instance.
//
// Invariant 17 (configuration version binding): a matter runs the workflow_definition
// VERSION it was opened against. So matter.open binds the latest active version
// (resolveActiveServiceVersion); the executor later re-reads THAT version by id
// (resolveBoundWorkflowById) rather than re-resolving "latest", which could have
// changed under it.
import type { DbClient } from '@exsto/shared'
import type { Lifecycle } from './types.js'

// Tolerantly parse a workflow_definition.states jsonb value into a stage graph.
// A non-array (null, object, garbage) becomes []. We do NOT validate structure
// here — validateLifecycle() (resolve.ts) is the gate when a graph is SAVED (PR4);
// the engine treats an empty graph as "no bound lifecycle" and stays a no-op.
export function parseStatesToGraph(states: unknown): Lifecycle {
  if (!Array.isArray(states)) return []
  return states as Lifecycle
}

export interface BoundWorkflowVersion {
  workflowDefinitionId: string
  version: number
  graph: Lifecycle
  status: string
}

// The latest active (valid_to IS NULL) workflow_definition for a service key, with
// its parsed graph. Returns null when there is no such row OR the row's states
// parse to an empty graph (a service with no authored lifecycle — the day-one
// state for every service until one is set in PR4).
export async function resolveActiveServiceVersion(
  client: DbClient,
  tenantId: string,
  serviceKey: string,
): Promise<BoundWorkflowVersion | null> {
  const res = await client.query<{
    id: string
    version: number
    states: unknown
    status: string
  }>(
    `SELECT id, version, states, status
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC
      LIMIT 1`,
    [tenantId, serviceKey],
  )
  const row = res.rows[0]
  if (!row) return null
  const graph = parseStatesToGraph(row.states)
  if (graph.length === 0) return null
  return {
    workflowDefinitionId: row.id,
    version: row.version,
    graph,
    status: row.status,
  }
}

// The same shape, resolved from ONE specific workflow_definition row by id. This is
// the version-pinned read (invariant 17): the executor binds a matter to the id its
// instance was started against and re-reads exactly that version's graph. Returns
// null if the row is gone (it should not be — definitions are not deleted).
export async function resolveBoundWorkflowById(
  client: DbClient,
  tenantId: string,
  workflowDefinitionId: string,
): Promise<BoundWorkflowVersion | null> {
  const res = await client.query<{
    id: string
    version: number
    states: unknown
    status: string
  }>(
    `SELECT id, version, states, status
       FROM workflow_definition
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, workflowDefinitionId],
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    workflowDefinitionId: row.id,
    version: row.version,
    graph: parseStatesToGraph(row.states),
    status: row.status,
  }
}

export interface MatterWorkflowInstance {
  id: string
  workflowDefinitionId: string
  subjectEntityId: string | null
  currentState: string
  stateHistory: unknown[]
  status: string
  // A per-INSTANCE graph override (jsonb, nullable). When set it supersedes the
  // bound definition version's states for THIS matter only (PR4 "edit this
  // matter's steps"). Null for the normal case (run the bound version verbatim).
  statesOverride: Lifecycle | null
}

// The matter's running workflow_instance (latest by started_at), or null if the
// matter has none (flag was off at open, or no authored lifecycle was bound).
export async function getWorkflowInstanceForMatter(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<MatterWorkflowInstance | null> {
  const res = await client.query<{
    id: string
    workflow_definition_id: string
    subject_entity_id: string | null
    current_state: string
    state_history: unknown[]
    status: string
    states_override: unknown
  }>(
    `SELECT id, workflow_definition_id, subject_entity_id, current_state,
            state_history, status, states_override
       FROM workflow_instance
      WHERE tenant_id = $1 AND subject_entity_id = $2
      ORDER BY started_at DESC
      LIMIT 1`,
    [tenantId, matterEntityId],
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    id: row.id,
    workflowDefinitionId: row.workflow_definition_id,
    subjectEntityId: row.subject_entity_id,
    currentState: row.current_state,
    stateHistory: Array.isArray(row.state_history) ? row.state_history : [],
    status: row.status,
    statesOverride: Array.isArray(row.states_override)
      ? (row.states_override as Lifecycle)
      : null,
  }
}
