import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, skipClientStage } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)

// Contract W (BACKHALF-BLOCKS-1 WP3) — the attorney SKIPS a client-gated stage:
// advances the client edge via legal.matter.advance (recorded + attributed to the
// attorney) plus a client_step_skipped_by_attorney observation. Works ONLY on a
// client-gated stage; the matter must actually be parked on the named stage.
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

  try {
    const { advancedTo } = await skipClientStage(ctx, matterId, stageKey)
    return NextResponse.json({ advancedTo })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to skip the stage.' },
      { status: 400 },
    )
  }
}
