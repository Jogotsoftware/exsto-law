// UI-BUILDER-FIX-1 Phase 9 — AI-regenerate for CONFIG artifacts (template /
// questionnaire / workflow / billing) THROUGH worker_job. Generative work never
// runs in-request: the modal enqueues legal.config.regenerate, the Render worker
// generates a PROPOSAL and records it as a config.regenerate.completed event
// (runtime kind, zero migrations), and the modal polls the read until it lands.
// NOTHING auto-applies — the proposal renders in the edit modal for the attorney
// to save/approve through the existing type-specific write actions.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { chatWithAssistantDetailed } from '../adapters/claude.js'
import { aiEnhanceTemplate } from './standaloneTemplates.js'
import { validateProposedQuestionnaire } from './intakeAuthoring.js'
import { validateProposedLifecycle } from './workflowAuthoring.js'
import { validateProposedCost } from './costAuthoring.js'
import type { ServiceCostType } from './services.js'
import type { Lifecycle } from '../lifecycle/index.js'

export const CONFIG_REGEN_JOB_KIND = 'legal.config.regenerate'

export type ConfigArtifactKind = 'template' | 'questionnaire' | 'workflow' | 'billing'

export interface ConfigRegenerateRequest {
  artifactKind: ConfigArtifactKind
  // template → the template entity id; the others → the service kind_name.
  targetId: string
  // The attorney's regenerate instruction ("tighten the indemnity clause", "add
  // a rush option") — applied AGAINST the current artifact, never from scratch.
  prompt: string
  // The CURRENT artifact content, serialized by the caller: template body (html/
  // markdown), questionnaire intake_schema JSON, workflow graph JSON, or the
  // current cost JSON. Passed through the job payload so the worker regenerates
  // against exactly what the attorney was looking at.
  current: string
}

export async function enqueueConfigRegenerate(
  ctx: ActionContext,
  input: ConfigRegenerateRequest,
): Promise<{ jobId: string; requestId: string }> {
  const prompt = (input.prompt ?? '').trim()
  if (!prompt) throw new Error('A regenerate instruction is required.')
  const requestId = randomUUID()
  const { enqueueJob } = await import('@exsto/worker-runtime')
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: CONFIG_REGEN_JOB_KIND,
    payload: {
      request_id: requestId,
      artifact_kind: input.artifactKind,
      target_id: input.targetId,
      prompt,
      current: input.current ?? '',
      requested_by: ctx.actorId,
    },
  })
  return { jobId, requestId }
}

// One-shot STRICT-JSON generation for the structured artifact kinds. The reply
// must be a single JSON value; tolerate a fenced block (the adapter's stop-slop
// habits) but nothing else.
async function oneShotJson(tenantId: string, system: string, user: string): Promise<unknown> {
  const { reply } = await chatWithAssistantDetailed(tenantId, [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const fenced = reply.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  const raw = ((fenced ? fenced[1] : reply) ?? '').trim()
  return JSON.parse(raw)
}

export interface ConfigRegenerateResult {
  ok: boolean
  artifactKind: ConfigArtifactKind
  targetId: string
  // The proposed replacement, serialized the same way `current` came in.
  proposed?: string
  errors?: string[]
}

// Executed BY THE WORKER (registered in workers/index.ts). Generates the
// proposal, validates it with the SAME validators the write paths use, and
// records the outcome as an event — the poll read below picks it up.
export async function runConfigRegenerateJob(
  ctx: ActionContext,
  payload: Record<string, unknown>,
): Promise<void> {
  const artifactKind = String(payload.artifact_kind ?? '') as ConfigArtifactKind
  const targetId = String(payload.target_id ?? '')
  const prompt = String(payload.prompt ?? '')
  const current = String(payload.current ?? '')
  const requestId = String(payload.request_id ?? '')

  let result: ConfigRegenerateResult
  try {
    if (artifactKind === 'template') {
      const { body } = await aiEnhanceTemplate(ctx, {
        currentBody: current,
        instructions: prompt,
        category: 'document',
      })
      result = { ok: true, artifactKind, targetId, proposed: body }
    } else if (artifactKind === 'questionnaire') {
      const schema = await oneShotJson(
        ctx.tenantId,
        'You revise a legal-intake questionnaire schema. Reply with ONLY the complete revised JSON schema (same shape as the input: {"sections":[{"id","title","fields":[…]}]}). Apply exactly the requested change; keep every other section and field verbatim. No prose.',
        `Current schema:\n${current}\n\nRequested change: ${prompt}`,
      )
      const v = validateProposedQuestionnaire(schema, [])
      result = v.ok
        ? { ok: true, artifactKind, targetId, proposed: JSON.stringify(schema, null, 2) }
        : { ok: false, artifactKind, targetId, errors: v.errors }
    } else if (artifactKind === 'workflow') {
      const graph = (await oneShotJson(
        ctx.tenantId,
        'You revise a legal matter workflow graph (a JSON array of stages: {key,label,client_label?,entry?,terminal?,action:{kind,config?},documents?,advances_to:[{to,gate,via?,on?}]}). Reply with ONLY the complete revised JSON array. Apply exactly the requested change; keep every other stage VERBATIM (same keys, labels, actions, gates, edges). The graph stays LINEAR with one entry and one terminal complete_matter stage. No prose.',
        `Current workflow graph:\n${current}\n\nRequested change: ${prompt}`,
      )) as Lifecycle
      const v = await validateProposedLifecycle(ctx, graph, targetId)
      result = v.ok
        ? { ok: true, artifactKind, targetId, proposed: JSON.stringify(graph, null, 2) }
        : { ok: false, artifactKind, targetId, errors: v.errors }
    } else if (artifactKind === 'billing') {
      const cost = (await oneShotJson(
        ctx.tenantId,
        'You revise a legal service\'s billing config: {"costType":"fixed"|"hourly","amount":"350.00","hours":number|null}. Reply with ONLY the revised JSON. Amounts are decimal strings. No prose.',
        `Current billing config:\n${current}\n\nRequested change: ${prompt}`,
      )) as { costType: ServiceCostType; amount: string; hours?: number | null }
      const v = validateProposedCost(cost)
      result = v.ok
        ? { ok: true, artifactKind, targetId, proposed: JSON.stringify(cost, null, 2) }
        : { ok: false, artifactKind, targetId, errors: v.errors }
    } else {
      result = {
        ok: false,
        artifactKind,
        targetId,
        errors: [`Unknown artifact kind "${artifactKind}"`],
      }
    }
  } catch (err) {
    result = {
      ok: false,
      artifactKind,
      targetId,
      errors: [err instanceof Error ? err.message : String(err)],
    }
  }

  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'exploration',
    payload: {
      event_kind_name: result.ok ? 'config.regenerate.completed' : 'config.regenerate.failed',
      primary_entity_id: null,
      source_type: 'agent',
      source_ref: ctx.actorId,
      data: {
        request_id: requestId,
        artifact_kind: artifactKind,
        target_id: targetId,
        prompt,
        proposed: result.proposed ?? null,
        errors: result.errors ?? null,
      },
    },
  })
}

// Phase 10: the LATEST completed rebuild proposal for a target (e.g. the
// questionnaire a template edit enqueued a rebuild for) — the Phase-9 modal
// surfaces it on open so an attorney finds the pending proposal without having
// asked for it in this session. Read-only; approving is the modal's save path.
export async function getLatestConfigProposalForTarget(
  ctx: ActionContext,
  artifactKind: ConfigArtifactKind,
  targetId: string,
): Promise<ConfigRegenerateResult | null> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ data: Record<string, unknown> }>(
      `SELECT e.payload AS data
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1
          AND ekd.kind_name = 'config.regenerate.completed'
          AND e.payload ->> 'artifact_kind' = $2
          AND e.payload ->> 'target_id' = $3
        ORDER BY e.occurred_at DESC
        LIMIT 1`,
      [ctx.tenantId, artifactKind, targetId],
    )
    const d = r.rows[0]?.data
    if (!d || typeof d.proposed !== 'string') return null
    return { ok: true, artifactKind, targetId, proposed: d.proposed }
  })
}

// Poll read for the modal: the regenerate outcome by request id (the enqueue's
// request_id rides the job payload into the event). Null while still running.
export async function getConfigRegenerateResult(
  ctx: ActionContext,
  requestId: string,
): Promise<ConfigRegenerateResult | null> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ kind_name: string; data: Record<string, unknown> }>(
      `SELECT ekd.kind_name, e.payload AS data
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1
          AND ekd.kind_name IN ('config.regenerate.completed','config.regenerate.failed')
          AND e.payload ->> 'request_id' = $2
        ORDER BY e.occurred_at DESC
        LIMIT 1`,
      [ctx.tenantId, requestId],
    )
    const row = r.rows[0]
    if (!row) return null
    const d = row.data
    return {
      ok: row.kind_name === 'config.regenerate.completed',
      artifactKind: String(d.artifact_kind ?? '') as ConfigArtifactKind,
      targetId: String(d.target_id ?? ''),
      proposed: typeof d.proposed === 'string' ? d.proposed : undefined,
      errors: Array.isArray(d.errors) ? (d.errors as string[]) : undefined,
    }
  })
}
