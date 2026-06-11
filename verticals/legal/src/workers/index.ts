// Vertical worker handlers (registered from the vertical — the core
// workers/runtime package stays untouched, ADR 0043). The dispatcher binds
// tenant context + the per-tenant system actor before invoking handlers.
import { registerWorkerHandler } from '@exsto/worker-runtime'
import { runGranolaProjection } from '../api/granolaIngestion.js'

// Projects a webhook'd (or polled) Granola payload into call_session +
// transcript via call.ingest. Retries/backoff per the worker runtime; the
// projection is idempotent on granola_call_id, so retries are safe.
registerWorkerHandler('legal.granola.project', async (ctx, payload) => {
  await runGranolaProjection(
    ctx,
    payload as { raw_event_log_id?: string | null; payload: Record<string, unknown> },
  )
})

// Runs one async drafting job (Lesson #2: drafting NEVER blocks the attorney
// or the request path). Transient model/API errors throw → runtime backoff.
registerWorkerHandler('legal.draft.run', async (ctx, payload) => {
  const { runDraftGeneration } = await import('../api/generateDraft.js')
  const p = payload as { matter_entity_id: string; document_kind: string }
  await runDraftGeneration(ctx, {
    matterEntityId: p.matter_entity_id,
    documentKind: p.document_kind as 'operating_agreement' | 'engagement_letter',
  })
})
