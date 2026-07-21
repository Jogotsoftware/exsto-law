// EDITOR-FIX-1 (item 1) — async Edit-with-AI. The tracked-changes editor's
// "Generate tracked changes" used to call reviseDraftText SYNCHRONOUSLY through
// the attorney MCP route, so the Claude redraft ran in-request and the gateway
// 504'd whenever the model was slow. Repo doctrine: model calls are ASYNC ALWAYS
// (the brief engine + prod-draft-offload are the precedents). So the revise now
// runs OFF the request on the worker:
//
//   legal.draft.revise.request  WRITE, ENQUEUE-AND-RETURN — enqueues a
//     `legal.draft.revise.run` worker_job (a free job-kind string; no migration,
//     no definition row) carrying the same ReviseDraftInput, and returns a
//     request id immediately. A click never holds an HTTP request open for the
//     model call.
//   legal.draft.revise.result  READ ONLY — the outcome for a request id, or null
//     while it is still running. The editor polls this (BriefButton pattern).
//
// The revise PROPOSAL is transient (nothing persists until the attorney Saves,
// via the append-only legal.draft.edit), so there is no natural artifact to poll
// like the brief has. It is carried on an `observation` event (a generic,
// already-defined runtime event kind — the config-regenerate loop's "runtime
// kind, zero migrations" escape hatch), keyed by request id in the payload. The
// reasoning trace reviseDraftText records is unchanged; the accept step still
// links it into version n+1 exactly as the synchronous path did.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { reviseDraftText, type ReviseDraftInput } from './reviseDraft.js'

export const DRAFT_REVISE_JOB_KIND = 'legal.draft.revise.run'

// The observation tags the worker records — the poll read below matches on these.
const REVISE_DONE_TAG = 'draft_revision_completed'
const REVISE_FAIL_TAG = 'draft_revision_failed'

export interface EnqueueDraftRevisionResult {
  jobId: string
  requestId: string
}

// Enqueue one async revision. Fast + in-request: validates the instruction, then
// hands the model work to the worker. requestId is the poll correlation key (it
// rides the job payload into the observation the worker records).
export async function enqueueDraftRevision(
  ctx: ActionContext,
  input: ReviseDraftInput,
): Promise<EnqueueDraftRevisionResult> {
  const instruction = (input.instruction ?? '').trim()
  if (!instruction) throw new Error('A revision instruction is required.')
  if (!input.documentVersionId) throw new Error('A document version id is required.')
  const requestId = randomUUID()
  const { enqueueJob } = await import('@exsto/worker-runtime')
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: DRAFT_REVISE_JOB_KIND,
    payload: {
      request_id: requestId,
      document_version_id: input.documentVersionId,
      instruction,
      // The editor's current accepted working text, so a revision composes with
      // unsaved accepted changes (unchanged from the synchronous path).
      base_markdown: input.baseMarkdown ?? null,
      requested_by: ctx.actorId,
    },
  })
  return { jobId, requestId }
}

export interface DraftRevisionJobResult {
  status: 'completed' | 'failed'
  requestId: string
  // Present on success — the COMPLETE revised markdown (the editor diffs it into
  // tracked changes exactly as the synchronous path returned it).
  revisedMarkdown?: string
  reasoningTraceId?: string
  modelIdentity?: string
  instruction?: string
  // Present on failure — a readable message for the editor's error rail.
  error?: string
}

// Executed BY THE WORKER (registered in workers/index.ts). Runs the SAME
// reviseDraftText pipeline the synchronous tool used, then records the outcome as
// an observation the poll read picks up. A thrown model/API error is caught and
// recorded as a failure observation (never silent) — the editor shows it with a
// Retry — and NOT rethrown, so the worker does not retry a bad instruction five
// times over (the attorney reruns from the rail instead).
export async function runDraftRevisionJob(
  ctx: ActionContext,
  payload: Record<string, unknown>,
): Promise<void> {
  const requestId = String(payload.request_id ?? '')
  const documentVersionId = String(payload.document_version_id ?? '')
  const instruction = String(payload.instruction ?? '')
  const baseMarkdown =
    typeof payload.base_markdown === 'string' ? (payload.base_markdown as string) : undefined

  let data: Record<string, unknown>
  let tag: string
  try {
    const result = await reviseDraftText(ctx, { documentVersionId, instruction, baseMarkdown })
    tag = REVISE_DONE_TAG
    data = {
      request_id: requestId,
      document_version_id: documentVersionId,
      revised_markdown: result.revisedMarkdown,
      reasoning_trace_id: result.reasoningTraceId,
      model_identity: result.modelIdentity,
      instruction: result.instruction,
    }
  } catch (err) {
    tag = REVISE_FAIL_TAG
    data = {
      request_id: requestId,
      document_version_id: documentVersionId,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'observation',
      primary_entity_id: null,
      source_type: 'agent',
      source_ref: ctx.actorId,
      data: { kind: tag, ...data },
    },
  })
}

// Poll read for the editor: the revision outcome by request id, or null while the
// worker is still running. Tenant-scoped through RLS; a foreign request id
// resolves to null (never another tenant's revision).
export async function getDraftRevisionResult(
  ctx: ActionContext,
  requestId: string,
): Promise<DraftRevisionJobResult | null> {
  return withActionContext(ctx, async (client) => {
    const r = await client.query<{ data: Record<string, unknown> }>(
      `SELECT e.payload AS data
         FROM event e
         JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
        WHERE e.tenant_id = $1
          AND ekd.kind_name = 'observation'
          AND e.payload ->> 'kind' IN ($2, $3)
          AND e.payload ->> 'request_id' = $4
        ORDER BY e.occurred_at DESC
        LIMIT 1`,
      [ctx.tenantId, REVISE_DONE_TAG, REVISE_FAIL_TAG, requestId],
    )
    const d = r.rows[0]?.data
    if (!d) return null
    if (d.kind === REVISE_DONE_TAG && typeof d.revised_markdown === 'string') {
      return {
        status: 'completed',
        requestId,
        revisedMarkdown: d.revised_markdown,
        reasoningTraceId: typeof d.reasoning_trace_id === 'string' ? d.reasoning_trace_id : undefined,
        modelIdentity: typeof d.model_identity === 'string' ? d.model_identity : undefined,
        instruction: typeof d.instruction === 'string' ? d.instruction : undefined,
      }
    }
    return {
      status: 'failed',
      requestId,
      error: typeof d.error === 'string' ? d.error : 'The revision could not be generated.',
    }
  })
}
