import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, setMatterWorkflow } from '@exsto/legal'
import '@exsto/legal' // register the legal.matter.set_workflow action handler (side effect)
import type { Lifecycle } from '@exsto/legal'

// Customize ONE matter's workflow (ADR 0045 PR6) — the "Edit steps for this matter"
// Save target. Delegates to setMatterWorkflow → legal.matter.set_workflow, which
// validates the graph (closed step-action vocabulary + linear), rejects a graph that
// would orphan the matter's current step, and writes workflow_instance.states_override.
// The service's default lifecycle is NEVER touched.
//
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the request body
// (hard rule 2). The matter id is the route param; the proposed graph is the body.
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant (RLS-scoped read
  // returns null otherwise). This is the load-bearing check, not the path param.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  const body = (await request.json().catch(() => null)) as { states?: unknown } | null
  if (!body || !Array.isArray(body.states)) {
    return NextResponse.json({ error: 'A workflow `states` array is required.' }, { status: 400 })
  }

  try {
    const res = await setMatterWorkflow(ctx, matterId, body.states as Lifecycle)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    // The handler rejects an invalid / orphaning graph — surface its message verbatim.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to customize the workflow.' },
      { status: 400 },
    )
  }
}
