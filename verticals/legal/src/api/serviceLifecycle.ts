// Service lifecycle API (ADR 0045, PR4a) — read + versioned write of a service's
// workflow stage graph (workflow_definition.states). The matter Workflow builder
// and the SMLLC author script call these.
//
// getServiceLifecycle reads the active service version's states and parses them to
// a Lifecycle. setServiceLifecycle submits legal.service.set_lifecycle, which
// validates the graph, seals the prior version, and inserts version+1 with the new
// states (display_name/description/transitions/participating_entity_kinds carried
// forward unchanged) — see handlers/serviceLibrary.ts.
import { withActionContext, submitAction, type ActionContext } from '@exsto/substrate'
import type { Lifecycle } from '../lifecycle/index.js'

// Bitemporal read discipline (exsto-query-substrate): the current active version of
// the service. Returns null when the service does not exist or has no states graph
// authored yet (states is an empty array on a service that has never been authored).
export async function getServiceLifecycle(
  ctx: ActionContext,
  serviceKey: string,
): Promise<{ graph: Lifecycle; version: number } | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ states: unknown; version: number }>(
      `SELECT states, version
         FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        ORDER BY version DESC
        LIMIT 1`,
      [ctx.tenantId, serviceKey],
    )
    const row = res.rows[0]
    if (!row) return null
    // states is jsonb; node-postgres returns it already parsed. An unauthored
    // service has [] (no graph yet) — surface that as null so callers can tell
    // "no lifecycle" apart from a one-stage graph.
    const graph = Array.isArray(row.states) ? (row.states as Lifecycle) : []
    if (graph.length === 0) return null
    return { graph, version: row.version }
  })
}

// Author a service's lifecycle graph. The set_lifecycle handler validates the graph
// (rejects an invalid one) and writes a new immutable version. intentKind
// 'adjustment' — shaping an existing service's steps (the AI authoring path in PR5
// will attach a reasoning trace; a manual save does not).
export async function setServiceLifecycle(
  ctx: ActionContext,
  serviceKey: string,
  graph: Lifecycle,
): Promise<{ workflowDefinitionId: string; serviceKey: string; version: number }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.set_lifecycle',
    intentKind: 'adjustment',
    payload: { service_key: serviceKey, graph },
  })
  return res.effects[0] as { workflowDefinitionId: string; serviceKey: string; version: number }
}
