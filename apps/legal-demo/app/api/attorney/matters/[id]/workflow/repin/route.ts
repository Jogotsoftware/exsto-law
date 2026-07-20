import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, repinMatterWorkflow } from '@exsto/legal'
import '@exsto/legal' // register the legal.matter.repin_workflow action handler (side effect)

// WF-FIX-1 (WP4) — move THIS matter to its service's latest workflow version
// (successor-instance repin; handlers/matterRepin.ts). The matter Workflow
// window's "Update to latest workflow" button POSTs here. Body (optional JSON):
// { targetState?, clearOverride? } — targetState only when the old stage key no
// longer exists in the new graph; clearOverride only to consent to discarding a
// per-matter customization. Handler errors are surfaced verbatim (the missing-
// stage error lists the valid stage keys).
//
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the request
// body (hard rule 2), exactly as the sibling workflow routes do.
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant (RLS-scoped read
  // returns null otherwise). This is the load-bearing check, not the path param.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as {
    targetState?: string
    clearOverride?: boolean
  } | null

  try {
    const res = await repinMatterWorkflow(ctx, matterId, {
      targetState: body?.targetState,
      clearOverride: body?.clearOverride,
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to update the workflow.' },
      { status: 400 },
    )
  }
}
