import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, enqueueCapabilityRunJob } from '@exsto/legal'
import '@exsto/legal' // register the legal action handlers (side effect)

// ADR 0046 / CAPABILITY-UNIFY-1 (WP3) — the matter Workflow window's "Run" affordance
// now ENQUEUES the capability run instead of executing it in-request. The always-on
// worker claims the legal.capability.run job and runs invokeCapabilityForMatter (which
// resolves the current invoke_capability stage, dispatches the real handler, records
// capability.invoked, and applies the gate) OFF the request — the SAME off-request path
// the producing auto-run uses, so a model-calling capability (document_generation,
// ai_document_review) can never outrun the serverless wall-clock. The route returns
// once the job is queued; the UI polls the matter for the result.
//
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the request body
// (hard rule 2); the matter must belong to the caller's tenant.
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant (RLS-scoped read
  // returns null otherwise). This is the load-bearing check, not the path param.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  try {
    // stage_key is the matter's current stage (recorded on the job for the timeline);
    // the worker re-resolves the live stage when it runs, so a stale key never misfires.
    const jobId = await enqueueCapabilityRunJob(ctx, matterId, matter.status ?? '')
    return NextResponse.json({ ok: true, enqueued: true, jobId })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to queue the capability.' },
      { status: 400 },
    )
  }
}
