import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { DocumentRef, GateKind, StepAction } from '../lifecycle/types.js'

// Workflow STEP library read layer (migration 0095, ADR 0045 PR4c). A
// workflow_step_template is a reusable workflow STEP (an entity, not service
// config) — the firm's library, droppable into any service's lifecycle via the
// Workflow builder. Mirrors the questionnaire library reads exactly.
//
// The stored STAGE is a LifecycleStage WITHOUT `advances_to`: a saved step carries
// its label / action / gate / documents / blocking, but NO edges. A half-edge (an
// advances_to to a stage not present in the target workflow) would fail
// validateLifecycle (resolve.ts), so the builder wires the outgoing edge + default
// gate at INSERTION time, exactly as a catalog add does. `key`/`entry`/`terminal`
// are likewise position-dependent and assigned by the builder on insertion, so
// they are NOT part of a saved step either.

export interface StepStage {
  label: string
  client_label?: string
  blocking?: boolean
  action: StepAction
  // `gate` is the gate the step's OUTGOING edge gets by default when dropped in
  // (mirrors the catalog's defaultGate); the actual edge is built at insertion.
  gate: GateKind
  documents?: DocumentRef[]
}

export interface WorkflowStepTemplate {
  workflowStepTemplateId: string
  name: string
  description: string | null
  stage: StepStage
  updatedAt: string
}

type WstRow = {
  workflow_step_template_id: string
  name: string | null
  description: string | null
  // jsonb → node-postgres returns a parsed object (or null).
  stage: StepStage | null
  updated_at: Date
}

const WST_SELECT = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id AS workflow_step_template_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'workflow_step_template_name')        AS name,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'workflow_step_template_description') AS description,
    (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'workflow_step_template_stage')                AS stage,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'workflow_step_template'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapWst(r: WstRow): WorkflowStepTemplate {
  // A stored stage always has at least a label + action + gate; default defensively
  // so a malformed row never throws on read.
  const stage: StepStage = r.stage ?? { label: '', action: { kind: 'manual_task' }, gate: 'attorney' }
  return {
    workflowStepTemplateId: r.workflow_step_template_id,
    name: r.name ?? '',
    description: r.description,
    stage,
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listWorkflowStepTemplates(
  ctx: ActionContext,
): Promise<WorkflowStepTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WstRow>(`${WST_SELECT} ORDER BY name`, [ctx.tenantId])
    return res.rows.map(mapWst)
  })
}

export async function getWorkflowStepTemplate(
  ctx: ActionContext,
  workflowStepTemplateId: string,
): Promise<WorkflowStepTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WstRow>(`${WST_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      workflowStepTemplateId,
    ])
    return res.rows[0] ? mapWst(res.rows[0]) : null
  })
}
