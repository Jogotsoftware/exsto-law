// RUNTIME-AUTORUN-2 — the producing-autorun runtime for the `generate_document` step.
//
// This is the generate_document sibling of capabilityRuntime.invokeCapabilityForMatter:
// the runtime that RUNS a producing stage when a matter enters it. The class-based
// afterCommit autorun (lifecycle/autoRun.ts) dispatches here for a generate_document
// stage exactly as it dispatches to invokeCapabilityForMatter for an invoke_capability
// stage — one post-commit queue, one advance path, two producing kinds.
//
// Execution model (identical invariant to #303): NEVER on the advance transaction. The
// autorun schedules this via ctx.afterCommit, so the (real, model-calling) draft runs
// in its own transaction AFTER the advance that landed the matter here has committed.
//
// What it does:
//   1. Resolve the matter's current stage; it must be a `generate_document` step.
//   2. Idempotency: if a draft for this document kind already exists on the matter
//      (an attorney generated it by hand, or a prior autorun already ran), do not
//      double-draft — just ensure the automatic edge is advanced.
//   3. Produce the REAL document through the PROVEN producer (generateDraft.runDraft-
//      Generation) — template + intake + drafting prompt → a document_version whose
//      content is a content_blob, attributed to the AI agent actor, emitting the
//      canonical `draft.completed` completion event. No new producer, no simulation.
//   4. Advance the stage's automatic edge via the SAME audited advance the capability
//      runtime uses (advanceAutomaticFromStage), recording `draft.completed` as the
//      trigger — moving the instance to the review stage, where it waits at the
//      attorney gate (review_send_document is not a producing kind → no further autorun).
//
// Honest failure (WP3 parity): a missing precondition (no document kind, no template,
// no questionnaire) records an observation and throws; the autorun catches it, leaves
// the matter parked + re-invocable, and never fakes a success or a document.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { hasAutomaticTransition, stageByKey } from '../lifecycle/resolve.js'
import type { Lifecycle, LifecycleStage } from '../lifecycle/types.js'
import { advanceAutomaticFromStage } from './capabilityRuntime.js'
import { runDraftGeneration } from './generateDraft.js'

// The AI agent actor — same id every AI write in the vertical uses (and the actor the
// generate_document producer already attributes its draft to). #303's actor.
const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface GenerateDocumentRuntimeResult {
  ran: boolean
  documentKind: string
  advanced: boolean
  summary: string
}

// Resolve the matter's current stage + the graph it is bound to (a per-instance
// states_override supersedes the bound version). Read-only.
async function resolveCurrentStage(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ currentState: string; stage: LifecycleStage | null; graph: Lifecycle } | null> {
  return withActionContext(ctx, async (client) => {
    const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
    if (!instance) return null
    let graph: Lifecycle =
      instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
    if (graph.length === 0) {
      const bound = await resolveBoundWorkflowById(
        client,
        ctx.tenantId,
        instance.workflowDefinitionId,
      )
      graph = bound?.graph ?? []
    }
    return {
      currentState: instance.currentState,
      stage: stageByKey(graph, instance.currentState),
      graph,
    }
  })
}

// The document kind this generate_document stage produces: the stage's own document
// ref wins; else the service's first registered document kind (transitions.documents).
async function resolveStageDocumentKind(
  ctx: ActionContext,
  matterEntityId: string,
  stage: LifecycleStage,
): Promise<string | null> {
  const fromStage = stage.documents?.map((d) => d.docKind).find((k): k is string => !!k?.trim())
  if (fromStage) return fromStage
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ documents: string[] | null }>(
      `SELECT wd.transitions -> 'documents' AS documents
         FROM workflow_instance wi
         JOIN workflow_definition wd ON wd.id = wi.workflow_definition_id
        WHERE wi.tenant_id = $1 AND wi.subject_entity_id = $2
        ORDER BY wi.started_at DESC LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )
    const docs = res.rows[0]?.documents
    return Array.isArray(docs) && typeof docs[0] === 'string' ? docs[0] : null
  })
}

// Has a draft for this document kind already been produced on this matter? (draft_of,
// matching document_kind). The idempotency guard so an autorun + a manual generate — or
// two autoruns — never double-draft.
async function draftAlreadyExists(
  ctx: ActionContext,
  matterEntityId: string,
  documentKind: string,
): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ n: string }>(
      `SELECT count(*) AS n FROM document_version dv
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id
        WHERE dv.tenant_id = $1 AND rel.target_entity_id = $2 AND rkd.kind_name = 'draft_of'
          AND coalesce(e_doc.metadata ->> 'document_kind', 'operating_agreement') = $3`,
      [ctx.tenantId, matterEntityId, documentKind],
    )
    return Number(res.rows[0]?.n ?? '0') > 0
  })
}

async function recordObservation(
  agentCtx: ActionContext,
  matterEntityId: string,
  tag: string,
  data: Record<string, unknown>,
): Promise<void> {
  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: matterEntityId,
      data: { kind: tag, ...data },
      source_type: 'agent',
      source_ref: CLAUDE_AGENT_ACTOR_ID,
    },
  })
}

// Run the generate_document stage the matter is currently parked on. Called ONLY from
// the post-commit autorun (never inline on an advance transaction).
export async function generateDocumentForMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<GenerateDocumentRuntimeResult> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }

  const info = await resolveCurrentStage(ctx, matterEntityId)
  if (!info || !info.stage) {
    // The matter advanced elsewhere before this ran — nothing to produce (idempotent).
    return {
      ran: false,
      documentKind: '',
      advanced: false,
      summary: 'No running stage to generate on.',
    }
  }
  const { stage, currentState } = info
  if (stage.action?.kind !== 'generate_document') {
    return {
      ran: false,
      documentKind: '',
      advanced: false,
      summary: `Stage "${stage.key}" is not a generate_document step (it is "${stage.action?.kind ?? 'none'}").`,
    }
  }

  const documentKind = await resolveStageDocumentKind(ctx, matterEntityId, stage)
  if (!documentKind) {
    await recordObservation(agentCtx, matterEntityId, 'generate_document_no_kind', {
      stage: stage.key,
    })
    throw new Error(
      `generate_document stage "${stage.key}" names no document kind (stage.documents / service documents both empty).`,
    )
  }

  // Idempotency: if the draft already exists, do not re-draft — just make sure the
  // automatic edge advanced (a prior run may have produced but failed to advance).
  if (await draftAlreadyExists(ctx, matterEntityId, documentKind)) {
    const advanced = hasAutomaticTransition(info.graph, currentState)
      ? await advanceAutomaticFromStage(agentCtx, matterEntityId, currentState, 'draft.completed')
      : false
    return {
      ran: false,
      documentKind,
      advanced,
      summary: `Draft for "${documentKind}" already exists on this matter — skipped generation (idempotent).`,
    }
  }

  // PRODUCE — the proven producer. Emits draft.completed; attributes to the agent actor.
  await runDraftGeneration(agentCtx, { matterEntityId, documentKind })

  // ADVANCE the automatic edge via the same audited path the capability runtime uses,
  // recording draft.completed (the real completion event) as the trigger. The matter
  // lands on the review stage and waits there (attorney gate).
  const advanced = await advanceAutomaticFromStage(
    agentCtx,
    matterEntityId,
    currentState,
    'draft.completed',
  )

  return {
    ran: true,
    documentKind,
    advanced,
    summary: `Generated "${documentKind}" and ${advanced ? 'advanced past' : 'parked at'} stage "${stage.key}".`,
  }
}
