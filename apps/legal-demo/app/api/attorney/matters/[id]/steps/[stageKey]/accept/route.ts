import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, acceptClientStage } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)

// Contract W addendum (RUNNER-FIXES-1 WP4) — the attorney RECORDS the client's
// out-of-band acceptance (phone/email) of a client-gated stage: fires
// legal.client_request.accept in its matter form, which records
// client_request.accepted on the matter and advances the client gate. The stage
// key in the path guards against a stale UI: the matter must actually be parked
// on the named stage.
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

  // Stale-UI guard (mirrors skip's expectedStageKey check, which lives inside
  // skipClientStage; acceptClientStage has no such parameter, so the route checks).
  const current = matter.workflow?.currentState ?? null
  if (current && current !== stageKey) {
    return NextResponse.json(
      { error: `The matter is at stage "${current}", not "${stageKey}" — refresh and retry.` },
      { status: 409 },
    )
  }

  const body = (await request.json().catch(() => null)) as { note?: string } | null

  try {
    const { accepted, advancedTo } = await acceptClientStage(ctx, {
      matterEntityId: matterId,
      note: body?.note?.trim() || undefined,
    })
    return NextResponse.json({ accepted, advancedTo })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to record the acceptance.' },
      { status: 400 },
    )
  }
}
