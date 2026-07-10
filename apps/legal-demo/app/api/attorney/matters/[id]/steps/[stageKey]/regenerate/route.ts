import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, enqueueRegenerateJob } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)

// Contract W (BACKHALF-BLOCKS-1 WP4) — REGENERATE the named stage's document with
// the attorney's change notes. In-request work is enqueue-only (legal.capability.run
// with a regenerate flag — no LLM in-request, ever); the worker produces version n+1
// on the existing draft entity, prior versions retained. 202: the job is queued, not
// done.
export const runtime = 'nodejs'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; stageKey: string }> },
) {
  const { id: matterId, stageKey } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { changeNotes?: string } | null
  const changeNotes = (body?.changeNotes ?? '').trim()

  try {
    const { jobId } = await enqueueRegenerateJob(ctx, matterId, stageKey, changeNotes)
    return NextResponse.json({ jobId }, { status: 202 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to enqueue the regeneration.' },
      { status: 400 },
    )
  }
}
