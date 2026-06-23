import { NextResponse } from 'next/server'
import { setServiceLifecycleAI, type Lifecycle } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Workflow-proposal APPROVE route (PR5) — THE HUMAN GATE. The chat turn that
// proposes a workflow writes NOTHING (decision 1): it only captures the proposal as
// an inline card. The live version write happens ONLY here, when the attorney clicks
// Approve. This is a THIN adapter over the operation core: it resolves the tenant
// from the signed session (never the request body), then delegates to
// setServiceLifecycleAI — which persists a reasoning_trace and submits
// legal.service.set_lifecycle AS THE CLAUDE AGENT ACTOR (intent 'adjustment', trace
// attached). It never touches the substrate directly. The serviceKey comes from the
// route, not the body, so the approval is for the workflow on the page the attorney
// is looking at.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceKey: string }> },
) {
  const { serviceKey } = await params
  if (!serviceKey) {
    return NextResponse.json({ error: 'serviceKey is required' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    graph?: Lifecycle
    summary?: string
    confidence?: number
  } | null
  if (!body || !Array.isArray(body.graph)) {
    return NextResponse.json({ error: 'A proposed graph is required.' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await setServiceLifecycleAI(ctxOrError, serviceKey, body.graph, {
      conclusion: (body.summary ?? '').trim() || `Authored a workflow for ${serviceKey}.`,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
    })
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
