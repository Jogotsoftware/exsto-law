import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, startMatterWorkflow } from '@exsto/legal'
import '@exsto/legal' // register the legal.matter.set_workflow action handler (side effect)

// MACHINE-COMMS-1 — the REPAIR control's write target: stand up the workflow
// instance for an existing matter that has none, instantiating from the matter's
// service current lifecycle (startMatterWorkflow → legal.matter.set_workflow with
// start:true, intent 'correction'). The "Workflow not started" panel on the matter
// page POSTs here; no body is needed — the matter id is the route param.
//
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the request
// body (hard rule 2), exactly as the sibling per-matter workflow route does.
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
    const res = await startMatterWorkflow(ctx, matterId)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    // The handler rejects a matter whose service has no lifecycle (or that already
    // has an instance) — surface its message verbatim.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to start the workflow.' },
      { status: 400 },
    )
  }
}
