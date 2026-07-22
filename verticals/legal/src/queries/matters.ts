import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  getWorkflowInstanceForMatter,
  resolveBoundWorkflowById,
  parseStatesToGraph,
} from '../lifecycle/binding.js'
import type { Lifecycle } from '../lifecycle/types.js'
import {
  deriveStageFromWorkflow,
  deriveStageFromLegacyStatus,
  type StageDisplay,
} from '../lifecycle/statusDisplay.js'
// Re-export the stage vocabulary so `@exsto/legal` consumers (the attorney app,
// the MCP tool) can type against it alongside MatterSummary/MatterDetail.
export type { StageDisplay, StageCategory } from '../lifecycle/statusDisplay.js'
import {
  resolveMatterJurisdictionWithClient,
  type ResolvedJurisdiction,
} from '../api/matterJurisdiction.js'

// Bitemporal read discipline (exsto-query-substrate): current attribute state =
// latest valid_from with valid_to open; relationships current via valid_to.
// Vocabulary (WP1 seed): client_of / response_of / call_of / draft_of point AT
// the matter; transcript_of points at the call (two hops from the matter).

export interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  serviceKey: string
  workflowRoute: string
  // Raw `matter_status` mirror. Kept for compat, but it drifts from the live
  // workflow and must NOT drive the status chip — use `stage` for display.
  status: string
  // The attorney-facing STATUS chip, derived from the matter's running workflow
  // (its true position), with the legacy status as a fallback. This is what the
  // matters list, the home dashboard, and the matter header render.
  stage: StageDisplay
  scheduledAt: string | null
  createdAt: string
  // Compat fields consumed by the existing attorney screens (WP8 retires them).
  practiceArea: string
  summary: string
}

export interface MatterDetail extends MatterSummary {
  attributes: Record<string, unknown>
  questionnaireResponses: Record<string, unknown> | null
  transcriptText: string | null
  latestDraftVersionId: string | null
  latestDraftStatus: string | null
  clientEmail: string | null
  // The client PARENT entity (matter_of, migration 0020), for linking a matter to
  // its client page. Null when the matter isn't grouped under a client yet.
  clientEntityId: string | null
  // The matter's RUNNING workflow instance + the graph of the version it is bound
  // to (ADR 0045 PR3). Null when the matter has no instance — the default today
  // (engine flag off at open, or a service with no authored lifecycle). The read
  // is additive and best-effort: a workflow read NEVER breaks getMatter (see
  // loadWorkflow's try/catch), so the no-workflow path is unchanged.
  workflow: {
    instanceId: string
    definitionId: string
    graph: Lifecycle
    currentState: string
    status: string
    // WF-FIX-1 (WP4): the bound version vs the service's latest — the Workflow
    // window shows "Update to latest workflow" when boundVersion < latestVersion.
    boundVersion: number | null
    latestVersion: number | null
    hasOverride: boolean
  } | null
  // MACHINE-COMMS-1 (WP0) — honesty flag: the matter has NO instance but its
  // service DOES carry an authored lifecycle (any status). The matter page must
  // then show the repair control ("start workflow"), NEVER the fabricated legacy
  // pipeline. False when an instance exists or the service has no lifecycle at all.
  workflowRepairAvailable: boolean
  // WP A1 — the resolved governing law: the matter's own override if set, else
  // the firm's home jurisdiction, else null (honest unset; no service rung, no
  // guessed default). DISPLAY ONLY here — the AI drafting/email/review consumers
  // still hardcode 'NC' until a later WP de-hardcodes them.
  governingLaw: ResolvedJurisdiction | null
}

export async function listMatters(ctx: ActionContext): Promise<MatterSummary[]> {
  return withActionContext(ctx, async (client) => {
    const rows = await client.query<{
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      service_key: string | null
      workflow_route: string | null
      status: string | null
      scheduled_at: string | null
      created_at: string
    }>(
      `SELECT
         e.id AS matter_entity_id,
         e.name AS matter_number,
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = r.source_entity_id
            JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'client_of'
            ORDER BY a2.valid_from DESC
            LIMIT 1) AS client_name,
         (SELECT a.value #>> '{}'
            FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'service_key'
           ORDER BY a.valid_from DESC
           LIMIT 1) AS service_key,
         (SELECT a.value #>> '{}'
            FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'workflow_route'
           ORDER BY a.valid_from DESC
           LIMIT 1) AS workflow_route,
         (SELECT a.value #>> '{}'
            FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
           WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_status'
             AND (a.valid_to IS NULL OR a.valid_to > now())
           ORDER BY a.valid_from DESC
           LIMIT 1) AS status,
         e.metadata->>'scheduled_at' AS scheduled_at,
         to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'matter'
         AND e.status = 'active'
         -- Exclude matters flagged as hidden test/demo data (metadata.demo_hidden).
         AND COALESCE(e.metadata->>'demo_hidden', '') <> 'true'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )
    // Resolve every matter's display stage from its running workflow in TWO batched
    // queries (not per-row), so the list stays inside the perf budget however many
    // matters a firm has.
    const stages = await loadMatterStages(
      client,
      ctx.tenantId,
      rows.rows.map((r) => r.matter_entity_id),
    )

    return rows.rows.map((r) => ({
      matterEntityId: r.matter_entity_id,
      matterNumber: r.matter_number,
      clientName: r.client_name ?? '',
      serviceKey: r.service_key ?? '',
      workflowRoute: r.workflow_route ?? 'manual',
      status: r.status ?? 'intake_submitted',
      stage:
        stages.get(r.matter_entity_id) ??
        deriveStageFromLegacyStatus(r.status ?? 'intake_submitted'),
      scheduledAt: r.scheduled_at,
      createdAt: r.created_at,
      practiceArea: r.service_key ?? '',
      summary: '',
    }))
  })
}

// Batched stage resolution for the matters list: one query for the latest workflow
// instance per matter, one for the bound definitions those instances point at, then
// derive each stage in memory. A per-instance states_override supersedes the bound
// version (invariant 17: run the version the matter was opened against). Matters
// with no instance are simply absent from the map — the caller falls back to the
// legacy status.
async function loadMatterStages(
  client: DbClient,
  tenantId: string,
  matterIds: string[],
): Promise<Map<string, StageDisplay>> {
  const out = new Map<string, StageDisplay>()
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
    out.set(inst.subject_entity_id, deriveStageFromWorkflow(graph, inst.current_state, inst.status))
  }
  return out
}

export async function getMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterDetail | null> {
  return withActionContext(ctx, async (client) => {
    const baseRes = await client.query<{
      id: string
      name: string
      scheduled_at: string | null
      created_at: string
    }>(
      `SELECT e.id, e.name, e.metadata->>'scheduled_at' AS scheduled_at, e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'matter'`,
      [ctx.tenantId, matterEntityId],
    )
    const base = baseRes.rows[0]
    if (!base) return null

    const attributes = await loadCurrentAttributes(client, ctx.tenantId, matterEntityId)
    const questionnaireResponses = await loadInboundRelatedAttribute<Record<string, unknown>>(
      client,
      ctx.tenantId,
      matterEntityId,
      'response_of',
      'questionnaire_responses',
    )
    const clientName = await loadInboundRelatedAttribute<string>(
      client,
      ctx.tenantId,
      matterEntityId,
      'client_of',
      'full_name',
    )
    const clientEmail = await loadInboundRelatedAttribute<string>(
      client,
      ctx.tenantId,
      matterEntityId,
      'client_of',
      'email',
    )
    const transcriptText = await loadTranscriptText(client, ctx.tenantId, matterEntityId)

    const latestDraft = await client.query<{
      version_id: string
      status: string
    }>(
      `SELECT dv.id AS version_id, dv.status
       FROM document_version dv
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1
         AND r.target_entity_id = $2
         AND rkd.kind_name = 'draft_of'
       ORDER BY dv.recorded_at DESC
       LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )

    const clientParent = await client.query<{ id: string }>(
      `SELECT r.target_entity_id AS id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = 'matter_of'
         AND (r.valid_to IS NULL OR r.valid_to > now())
       LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )

    const workflow = await loadWorkflow(client, ctx.tenantId, matterEntityId)
    const governingLaw = await resolveMatterJurisdictionWithClient(
      client,
      ctx.tenantId,
      matterEntityId,
    )

    // WP0 honesty: with no instance, does the service have an authored lifecycle
    // the repair control could instantiate? Any-status current row, non-empty graph.
    let workflowRepairAvailable = false
    if (!workflow) {
      const serviceKey = (attributes.service_key as string | undefined) ?? ''
      if (serviceKey) {
        const def = await client.query<{ n: number }>(
          `SELECT jsonb_array_length(states) AS n FROM workflow_definition
            WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
              AND jsonb_typeof(states) = 'array'
            ORDER BY version DESC LIMIT 1`,
          [ctx.tenantId, serviceKey],
        )
        workflowRepairAvailable = (def.rows[0]?.n ?? 0) > 0
      }
    }

    return {
      matterEntityId,
      matterNumber: base.name,
      clientName: clientName ?? '',
      serviceKey: (attributes.service_key as string | undefined) ?? '',
      workflowRoute: (attributes.workflow_route as string | undefined) ?? 'manual',
      status: (attributes.matter_status as string | undefined) ?? 'intake_submitted',
      stage: workflow
        ? deriveStageFromWorkflow(workflow.graph, workflow.currentState, workflow.status)
        : deriveStageFromLegacyStatus(
            (attributes.matter_status as string | undefined) ?? 'intake_submitted',
          ),
      scheduledAt: base.scheduled_at,
      createdAt: base.created_at,
      practiceArea: (attributes.service_key as string | undefined) ?? '',
      summary: '',
      attributes,
      questionnaireResponses: questionnaireResponses ?? null,
      transcriptText: transcriptText ?? null,
      latestDraftVersionId: latestDraft.rows[0]?.version_id ?? null,
      latestDraftStatus: latestDraft.rows[0]?.status ?? null,
      clientEmail: clientEmail ?? null,
      clientEntityId: clientParent.rows[0]?.id ?? null,
      workflow,
      workflowRepairAvailable,
      governingLaw,
    }
  })
}

// The matter's running workflow instance + the graph of the version it is bound to
// (invariant 17: re-read THAT version by id, never re-resolve "latest"). A
// per-instance states_override supersedes the bound version for this matter.
// Best-effort by contract: any failure returns null so getMatter's existing shape
// is never broken by the workflow read — the no-workflow path stays exactly as it
// was before PR3.
async function loadWorkflow(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<MatterDetail['workflow']> {
  try {
    const instance = await getWorkflowInstanceForMatter(client, tenantId, matterEntityId)
    if (!instance) return null
    const bound = await resolveBoundWorkflowById(client, tenantId, instance.workflowDefinitionId)
    const hasOverride = !!instance.statesOverride && instance.statesOverride.length > 0
    const graph: Lifecycle = hasOverride ? instance.statesOverride! : (bound?.graph ?? [])
    // Latest version by the bound definition's kind_name (= service key) — drives
    // the repin affordance. Best-effort like the rest of this read.
    let latestVersion: number | null = null
    if (bound) {
      const latest = await client.query<{ version: number }>(
        `SELECT version FROM workflow_definition
          WHERE tenant_id = $1 AND kind_name = (
            SELECT kind_name FROM workflow_definition WHERE tenant_id = $1 AND id = $2
          ) AND valid_to IS NULL
          ORDER BY version DESC LIMIT 1`,
        [tenantId, instance.workflowDefinitionId],
      )
      latestVersion = latest.rows[0]?.version ?? null
    }
    return {
      instanceId: instance.id,
      definitionId: instance.workflowDefinitionId,
      graph,
      currentState: instance.currentState,
      status: instance.status,
      boundVersion: bound?.version ?? null,
      latestVersion,
      hasOverride,
    }
  } catch {
    return null
  }
}

async function loadCurrentAttributes(
  client: DbClient,
  tenantId: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  const res = await client.query<{ kind_name: string; value: unknown }>(
    // Current = latest OPEN row per kind. The open filter is load-bearing: a matter
    // that carries stacked/closed status rows (pre-supersede data, or the one-time
    // repair) must resolve to the single open value, not an arbitrary tied row
    // (WF-FIX-2 #2). matter_status detail reads this map's `matter_status` key.
    `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = $2
       AND (a.valid_to IS NULL OR a.valid_to > now())
     ORDER BY akd.kind_name, a.valid_from DESC`,
    [tenantId, entityId],
  )
  const out: Record<string, unknown> = {}
  for (const row of res.rows) {
    out[row.kind_name] = row.value
  }
  return out
}

// Latest attribute on an entity RELATED INTO the matter (relationship source →
// matter target), e.g. the questionnaire_response's payload via response_of.
async function loadInboundRelatedAttribute<T>(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
  relationshipKindName: string,
  attributeKindName: string,
): Promise<T | null> {
  const res = await client.query<{ value: T }>(
    `SELECT a.value
     FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     JOIN attribute a ON a.entity_id = r.source_entity_id
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE r.tenant_id = $1
       AND r.target_entity_id = $2
       AND rkd.kind_name = $3
       AND akd.kind_name = $4
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, matterEntityId, relationshipKindName, attributeKindName],
  )
  return res.rows[0]?.value ?? null
}

// Transcript is two hops out: transcript --transcript_of--> call --call_of--> matter.
async function loadTranscriptText(
  client: DbClient,
  tenantId: string,
  matterEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ value: string }>(
    `SELECT a.value #>> '{}' AS value
     FROM relationship rc
     JOIN relationship_kind_definition rkc ON rkc.id = rc.relationship_kind_id AND rkc.kind_name = 'call_of'
     JOIN relationship rt ON rt.target_entity_id = rc.source_entity_id AND rt.tenant_id = rc.tenant_id
     JOIN relationship_kind_definition rkt ON rkt.id = rt.relationship_kind_id AND rkt.kind_name = 'transcript_of'
     JOIN attribute a ON a.entity_id = rt.source_entity_id AND a.tenant_id = rc.tenant_id
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name = 'transcript_text'
     WHERE rc.tenant_id = $1 AND rc.target_entity_id = $2
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, matterEntityId],
  )
  return res.rows[0]?.value ?? null
}
