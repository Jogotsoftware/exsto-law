import type { DbClient } from '@exsto/shared'
import type { Lifecycle } from '../lifecycle/types.js'
import { parseStatesToGraph } from '../lifecycle/binding.js'
import { deriveCanonicalMatterStatus } from '../lifecycle/statusDisplay.js'

// A matter's position in its LIVE workflow: the bound graph (per-instance override
// wins), the current state, and the instance status. Resolved in TWO batched queries
// for a whole set of matters, so any read that needs the true stage (the matters
// list, the CRM pipeline, the calendar heuristic) stays inside the perf budget
// however many matters it walks. Matters with no running instance are simply absent
// from the map — every caller falls back to the legacy `matter_status` attribute.
export interface MatterWorkflowPosition {
  graph: Lifecycle
  currentState: string
  wfStatus: string
}

export async function loadMatterWorkflowPositions(
  client: DbClient,
  tenantId: string,
  matterIds: string[],
): Promise<Map<string, MatterWorkflowPosition>> {
  const out = new Map<string, MatterWorkflowPosition>()
  if (matterIds.length === 0) return out

  const instances = await client.query<{
    subject_entity_id: string
    workflow_definition_id: string
    current_state: string
    status: string
    states_override: unknown
  }>(
    `SELECT DISTINCT ON (subject_entity_id)
            subject_entity_id, workflow_definition_id, current_state, status, states_override
       FROM workflow_instance
      WHERE tenant_id = $1 AND subject_entity_id = ANY($2)
      ORDER BY subject_entity_id, started_at DESC`,
    [tenantId, matterIds],
  )
  if (instances.rows.length === 0) return out

  const defIds = Array.from(new Set(instances.rows.map((r) => r.workflow_definition_id)))
  const defs = await client.query<{ id: string; states: unknown }>(
    `SELECT id, states FROM workflow_definition WHERE tenant_id = $1 AND id = ANY($2)`,
    [tenantId, defIds],
  )
  const graphByDef = new Map<string, Lifecycle>(
    defs.rows.map((d) => [d.id, parseStatesToGraph(d.states)]),
  )

  for (const inst of instances.rows) {
    const override = Array.isArray(inst.states_override)
      ? (inst.states_override as Lifecycle)
      : null
    const graph = override ?? graphByDef.get(inst.workflow_definition_id) ?? []
    out.set(inst.subject_entity_id, {
      graph,
      currentState: inst.current_state,
      wfStatus: inst.status,
    })
  }
  return out
}

// Canonical `matter_status` per matter, in the LEGACY vocabulary, derived from the
// live workflow. Matters with no instance are absent (caller keeps the raw mirror).
// This is the single overlay every stage-reader uses to stop trusting the drifting
// `matter_status` attribute.
export async function resolveCanonicalMatterStatuses(
  client: DbClient,
  tenantId: string,
  matterIds: string[],
): Promise<Map<string, string>> {
  const positions = await loadMatterWorkflowPositions(client, tenantId, matterIds)
  const out = new Map<string, string>()
  for (const [matterId, p] of positions) {
    out.set(matterId, deriveCanonicalMatterStatus(p.graph, p.currentState, p.wfStatus))
  }
  return out
}
