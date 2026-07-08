import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, invokeCapabilityForMatter } from '@exsto/legal'
import '@exsto/legal' // register the legal action handlers (side effect)

// ADR 0046 — run the capability the matter's CURRENT invoke_capability stage points
// at (the matter Workflow window's "Run" affordance). The runtime resolves the
// stage's capability + config from the registry, dispatches the real handler,
// records a capability.invoked audit event, and applies the capability's gate
// (attorney/client → the matter parks for the gate's own action; automatic/system →
// it advances). A contracted-but-unbuilt capability returns a clear error (400).
//
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the request body
// (hard rule 2); the matter must belong to the caller's tenant. maxDuration is raised
// because an AI-review capability calls the model.
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant (RLS-scoped read
  // returns null otherwise). This is the load-bearing check, not the path param.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

  try {
    const res = await invokeCapabilityForMatter(ctx, matterId)
    return NextResponse.json({ ok: true, ...res })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to run the capability.' },
      { status: 400 },
    )
  }
}
