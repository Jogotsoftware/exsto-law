import { NextResponse } from 'next/server'
import { createCostAI, type ServiceCostType } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Cost-proposal APPROVE route (Build-Wizard Phase 6 — billing) — THE HUMAN GATE. The
// chat turn that proposes a fee model writes NOTHING: it only captures the proposal as
// an inline card. The live cost write happens ONLY here, when the attorney clicks
// Approve. This is a THIN adapter over the operation core: it resolves the tenant from
// the signed session (never the request body), then delegates to createCostAI — which
// persists a reasoning_trace and sets the cost AS THE CLAUDE AGENT ACTOR (via the
// legal.service.upsert cost-patch path, trace attached). It never touches the substrate
// directly. The serviceKey comes from the route, not the body, so the approval prices
// the service the attorney is looking at.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceKey: string }> },
) {
  const { serviceKey } = await params
  if (!serviceKey) {
    return NextResponse.json({ error: 'serviceKey is required' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    documentFees?: Record<string, string>
    costType?: ServiceCostType
    amount?: string
    hours?: number | null
    summary?: string
    confidence?: number
  } | null
  const costType = body?.costType
  const amount = (body?.amount ?? '').trim()
  if ((costType !== 'hourly' && costType !== 'fixed') || !amount) {
    return NextResponse.json(
      { error: "A cost type ('hourly' or 'fixed') and an amount are required." },
      { status: 400 },
    )
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await createCostAI(
      ctxOrError,
      serviceKey,
      {
        costType,
        amount,
        hours: body?.hours ?? null,
        ...(body?.documentFees ? { documentFees: body.documentFees } : {}),
      },
      {
        conclusion:
          (body?.summary ?? '').trim() || `Set the ${costType} fee for ${serviceKey} to ${amount}.`,
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      },
    )
    // Return the LINK to the service's billing page + serviceKey + label so the chat
    // can show "View billing →" and auto-continue the guided build (Phase 6).
    return NextResponse.json({
      result,
      serviceKey,
      link: `/attorney/services/${encodeURIComponent(serviceKey)}/billing`,
      label: 'Billing',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
