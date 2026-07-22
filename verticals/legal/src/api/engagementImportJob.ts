// ENGAGEMENT-DOC-1 fix — the engagement-letter import runs a full drafting-model
// pass (a 7-page letter re-emitted with merge tokens ≈ 80s), so doing it
// synchronously in the attorney MCP route 504'd the gateway. Repo doctrine: model
// calls are ASYNC ALWAYS (prod-draft-offload, brief engine, Edit-with-AI are the
// precedents). So the import now runs OFF the request on the worker, mirroring
// reviseDraftJob.ts exactly:
//
//   legal.firm.import_engagement_agreement          WRITE, ENQUEUE-AND-RETURN —
//     enqueues a `legal.firm.import_engagement_agreement.run` worker_job (free
//     job-kind string; no migration) carrying the parsed letter markdown, and
//     returns a request id immediately.
//   legal.firm.import_engagement_agreement.result   READ ONLY — the outcome for a
//     request id, or null while it is still running. The settings card polls it.
//
// The outcome rides a generic `observation` event (an already-defined runtime
// event kind — the same zero-migration escape hatch reviseDraftJob uses), keyed by
// request id. The pointer + template the import writes ARE persisted by
// importEngagementAgreement itself; this observation only carries the poll signal.
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  importEngagementAgreement,
  type EngagementAgreementDetails,
} from './engagementAgreement.js'

export const ENGAGEMENT_IMPORT_JOB_KIND = 'legal.firm.import_engagement_agreement.run'

const IMPORT_DONE_TAG = 'engagement_import_completed'
const IMPORT_FAIL_TAG = 'engagement_import_failed'

export interface EnqueueEngagementImportResult {
  jobId: string
  requestId: string
}

export interface EngagementImportJobResult {
  status: 'completed' | 'failed'
  requestId: string
  templateId?: string
  templateName?: string
  version?: number
  details?: EngagementAgreementDetails
  error?: string
}

// Enqueue one async import. Fast + in-request: validates the parsed markdown, then
// hands the model work to the worker. requestId is the poll correlation key.
export async function enqueueEngagementImport(
  ctx: ActionContext,
  input: { markdown: string; sourceFilename?: string },
): Promise<EnqueueEngagementImportResult> {
  const markdown = (input.markdown ?? '').trim()
  if (!markdown) throw new Error('The uploaded document contained no readable text.')
  const requestId = randomUUID()
  const { enqueueJob } = await import('@exsto/worker-runtime')
  const jobId = await enqueueJob({
    tenantId: ctx.tenantId,
    jobKind: ENGAGEMENT_IMPORT_JOB_KIND,
    payload: {
      request_id: requestId,
      markdown,
      source_filename: input.sourceFilename ?? null,
      requested_by: ctx.actorId,
    },
  })
  return { jobId, requestId }
}

// Executed BY THE WORKER (registered in workers/index.ts). Runs the SAME
// importEngagementAgreement pipeline the synchronous tool used, then records the
// outcome as an observation the poll read picks up. A thrown model/parse error is
// caught and recorded as a failure observation (never silent) — the card shows it
// with a retry — and NOT rethrown, so the worker does not retry a slow/bad import
// five times over.
export async function runEngagementImportJob(
  ctx: ActionContext,
  payload: Record<string, unknown>,
): Promise<void> {
  const requestId = String(payload.request_id ?? '')
  const markdown = String(payload.markdown ?? '')
  const sourceFilename =
    typeof payload.source_filename === 'string' ? (payload.source_filename as string) : undefined

  let data: Record<string, unknown>
  let tag: string
  try {
    const result = await importEngagementAgreement(ctx, { markdown, sourceFilename })
    tag = IMPORT_DONE_TAG
    data = {
      request_id: requestId,
      template_id: result.templateId,
      template_name: result.templateName,
      version: result.version,
      details: result.details,
    }
  } catch (err) {
    tag = IMPORT_FAIL_TAG
    data = {
      request_id: requestId,
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

// Poll read for the settings card: the import outcome by request id, or null while
// the worker is still running. Tenant-scoped through RLS; a foreign request id
// resolves to null.
export async function getEngagementImportResult(
  ctx: ActionContext,
  requestId: string,
): Promise<EngagementImportJobResult | null> {
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
      [ctx.tenantId, IMPORT_DONE_TAG, IMPORT_FAIL_TAG, requestId],
    )
    const d = r.rows[0]?.data
    if (!d) return null
    if (d.kind === IMPORT_DONE_TAG && typeof d.template_id === 'string') {
      return {
        status: 'completed',
        requestId,
        templateId: d.template_id,
        templateName: typeof d.template_name === 'string' ? d.template_name : undefined,
        version: typeof d.version === 'number' ? d.version : undefined,
        details:
          d.details && typeof d.details === 'object'
            ? (d.details as EngagementAgreementDetails)
            : undefined,
      }
    }
    return {
      status: 'failed',
      requestId,
      error:
        typeof d.error === 'string' ? d.error : 'The engagement agreement could not be imported.',
    }
  })
}
