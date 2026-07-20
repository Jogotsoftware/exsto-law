// BACKHALF-BLOCKS-1 (WP4) — REGENERATE a stage's document with the attorney's change
// notes (Contract W: POST .../steps/[stageKey]/regenerate). Deliberate regeneration
// SUPERSEDES the idempotency guards a normal run obeys:
//   • it targets the NAMED stage (the matter is usually parked PAST it, at review) —
//     not the current stage — so the capability.invoked (matter, stage) guard and
//     the draft-exists guard are intentionally bypassed;
//   • the produced draft is written as version n+1 on the SAME document_draft entity
//     (prior versions retained, append-only — the document.edit pattern);
//   • changeNotes ride the producer's `guidance` input, appended AFTER the step's
//     standing instructions: they change WHAT is drafted, never the output/trace
//     format (the format lives in the base prompt — the CAPABILITY-UNIFY-1 lesson).
// Enqueue is the ONLY in-request work (legal.capability.run with a regenerate flag);
// the model call runs on the worker — no LLM in-request, ever.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { stageByKey } from '../lifecycle/resolve.js'
import type { Lifecycle, LifecycleStage } from '../lifecycle/types.js'
import type { CapabilityStepConfig } from '../lifecycle/types.js'
import { CAPABILITY_RUN_JOB_KIND, slugifyDocKind } from './capabilityRuntime.js'
import { resolveStageDocumentKind } from './generateDocumentRuntime.js'
import type { GenerationMode } from './generateDraft.js'

// The AI agent actor (same id every AI write in the vertical uses — tenant-zero
// seed; observation writes only, the drafting itself resolves its own actor).
import { resolveTenantAgentCtx } from './tenantActors.js'

async function loadGraphForMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<{ currentState: string; graph: Lifecycle } | null> {
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
    return { currentState: instance.currentState, graph }
  })
}

function isDocumentProducing(stage: LifecycleStage): boolean {
  if (stage.action?.kind === 'generate_document') return true
  if (stage.action?.kind === 'invoke_capability') {
    const cfg = (stage.action.config ?? {}) as unknown as CapabilityStepConfig
    return (cfg.capability_slug ?? '').trim() === 'document_generation'
  }
  return false
}

async function recordObservation(
  ctx: ActionContext,
  matterEntityId: string,
  tag: string,
  data: Record<string, unknown>,
): Promise<void> {
  const agentCtx = await resolveTenantAgentCtx(ctx)
  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: matterEntityId,
      data: { kind: tag, ...data },
      source_type: 'agent',
      source_ref: agentCtx.actorId,
    },
  })
}

// ── Request side: validate + enqueue (fast, no model call) ──────────────────────

export interface EnqueueRegenerateResult {
  jobId: string
  stageKey: string
}

export async function enqueueRegenerateJob(
  ctx: ActionContext,
  matterEntityId: string,
  stageKey: string,
  changeNotes: string,
): Promise<EnqueueRegenerateResult> {
  if (!matterEntityId?.trim()) throw new Error('matterEntityId is required.')
  if (!stageKey?.trim()) throw new Error('stageKey is required.')

  const info = await loadGraphForMatter(ctx, matterEntityId)
  if (!info || info.graph.length === 0) {
    throw new Error(`Matter ${matterEntityId} has no running workflow to regenerate on.`)
  }
  const stage = stageByKey(info.graph, stageKey)
  if (!stage) throw new Error(`Stage "${stageKey}" is not in this matter's workflow.`)
  if (!isDocumentProducing(stage)) {
    throw new Error(
      `Stage "${stageKey}" does not produce a document — regenerate applies only to a drafting stage.`,
    )
  }

  const { enqueueJob } = await import('@exsto/worker-runtime')
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: CAPABILITY_RUN_JOB_KIND,
    payload: {
      matter_entity_id: matterEntityId,
      stage_key: stageKey,
      regenerate: true,
      change_notes: (changeNotes ?? '').trim(),
      requested_by: ctx.actorId,
    },
  })
  await recordObservation(ctx, matterEntityId, 'regenerate_enqueued', {
    stage: stageKey,
    job_id: jobId,
  })
  return { jobId, stageKey }
}

// ── Worker side: produce version n+1 (model call lives here) ────────────────────

export interface RegenerateStageResult {
  ran: boolean
  documentKind: string
  documentVersionId: string | null
  versionNumber: number | null
  summary: string
}

export async function regenerateStageDocument(
  ctx: ActionContext,
  matterEntityId: string,
  stageKey: string,
  changeNotes: string,
): Promise<RegenerateStageResult> {
  const info = await loadGraphForMatter(ctx, matterEntityId)
  const stage = info ? stageByKey(info.graph, stageKey) : null
  if (!info || !stage || !isDocumentProducing(stage)) {
    // The graph changed between enqueue and run — record and stop, never guess.
    await recordObservation(ctx, matterEntityId, 'regenerate_stage_missing', {
      stage: stageKey,
    })
    return {
      ran: false,
      documentKind: '',
      documentVersionId: null,
      versionNumber: null,
      summary: `Stage "${stageKey}" is no longer a drafting stage on this matter — nothing regenerated.`,
    }
  }

  // Resolve the document kind + template exactly the way the ORIGINAL run did.
  let documentKind: string
  let templateOverride: { templateText: string; templateId: string } | undefined
  let generationMode: GenerationMode | undefined
  let standingInstructions = ''

  if (stage.action?.kind === 'invoke_capability') {
    const cfg = (stage.action.config ?? {}) as unknown as CapabilityStepConfig
    const capabilityConfig = (cfg.capability_config ?? {}) as Record<string, unknown>
    const templateEntityId = String(
      (capabilityConfig.template_entity_id as string | undefined) ?? '',
    ).trim()
    if (!templateEntityId) {
      throw new Error(
        `Stage "${stageKey}" names no template_entity_id — cannot regenerate its document.`,
      )
    }
    const { getStandaloneTemplate } = await import('../queries/templates.js')
    const tmpl = await getStandaloneTemplate(ctx, templateEntityId)
    if (!tmpl || !tmpl.body.trim()) {
      throw new Error(
        `Stage "${stageKey}" template "${templateEntityId}" is not an active firm template — cannot regenerate.`,
      )
    }
    documentKind = (tmpl.docKind ?? '').trim() || slugifyDocKind(tmpl.name)
    templateOverride = { templateText: tmpl.body, templateId: `template:${templateEntityId}` }
    generationMode =
      String(capabilityConfig.generation_mode ?? '').trim() === 'template_merge'
        ? 'template_merge'
        : 'ai_draft'
    standingInstructions = String(
      (capabilityConfig.instructions as string | undefined) ?? '',
    ).trim()
  } else {
    const kind = await resolveStageDocumentKind(ctx, matterEntityId, stage)
    if (!kind) {
      throw new Error(`Stage "${stageKey}" names no document kind — cannot regenerate.`)
    }
    documentKind = kind
  }

  // The existing draft entity for this (matter, documentKind) — the supersede
  // target. Absent one (never drafted), the regenerate is just the first draft.
  const supersedesDocumentEntityId = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT dv.document_entity_id AS id FROM document_version dv
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship rel ON rel.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = rel.relationship_kind_id
        WHERE dv.tenant_id = $1 AND rel.target_entity_id = $2 AND rkd.kind_name = 'draft_of'
          AND coalesce(e_doc.metadata ->> 'document_kind', 'operating_agreement') = $3
        ORDER BY dv.recorded_at DESC LIMIT 1`,
      [ctx.tenantId, matterEntityId, documentKind],
    )
    return res.rows[0]?.id ?? null
  })

  // changeNotes append AFTER the standing instructions: both are guidance (WHAT to
  // draft); the output/trace contract stays in the base prompt, untouchable from here.
  const guidance = [standingInstructions, (changeNotes ?? '').trim()]
    .filter(Boolean)
    .join('\n\nAttorney change notes for this regeneration:\n')

  const { runDraftGeneration } = await import('./generateDraft.js')
  const produced = await runDraftGeneration(ctx, {
    matterEntityId,
    documentKind,
    generationMode,
    guidance: guidance || undefined,
    templateOverride,
    supersedesDocumentEntityId: supersedesDocumentEntityId ?? undefined,
  })
  if (!produced) {
    throw new Error(
      `Regenerate could not produce "${documentKind}" (draft precondition failed; see draft.failed).`,
    )
  }
  const effects = (produced.effects[0] ?? {}) as {
    documentVersionId?: string
    versionNumber?: number
  }
  return {
    ran: true,
    documentKind,
    documentVersionId: effects.documentVersionId ?? null,
    versionNumber: effects.versionNumber ?? null,
    summary: `Regenerated "${documentKind}" as version ${effects.versionNumber ?? '?'} — pending attorney review.`,
  }
}
