import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, completeMatter } from '@exsto/legal'
import '@exsto/legal' // register action handlers (side effect)

// Contract W (BACKHALF-BLOCKS-1 WP2) — COMPLETE the matter: executes the workflow's
// declared completion step. Best-effort attorney advance to the terminal stage,
// legal.service.complete (accrues the service completion fee — idempotent), and,
// when archive is set, entity.archive of the matter (ARCHIVED, never deleted).
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { archive?: boolean } | null
  const archive = body?.archive === true

  try {
    const result = await completeMatter(ctx, matterId, { archive })
    return NextResponse.json({ completed: result.completed, ...result })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to complete the matter.' },
      { status: 400 },
    )
  }
}
