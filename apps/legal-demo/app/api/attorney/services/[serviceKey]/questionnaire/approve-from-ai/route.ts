import { NextResponse } from 'next/server'
import { createQuestionnaireAI } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Questionnaire-proposal APPROVE route (Build-Wizard Phase 2) — THE HUMAN GATE. The
// chat turn that proposes an intake questionnaire writes NOTHING: it only captures
// the proposal as an inline card (with its variable-contract coverage). The live
// write happens ONLY here, when the attorney clicks Approve. This is a THIN adapter
// over the operation core: it resolves the tenant from the signed session (never the
// request body), then delegates to createQuestionnaireAI — which persists a
// reasoning_trace and submits the intake_schema write AS THE CLAUDE AGENT ACTOR
// (intent 'adjustment', trace attached). It never touches the substrate directly.
// The serviceKey comes from the route, not the body, so the approval is for the form
// on the service the attorney is looking at.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceKey: string }> },
) {
  const { serviceKey } = await params
  if (!serviceKey) {
    return NextResponse.json({ error: 'serviceKey is required' }, { status: 400 })
  }

  const body = (await request.json().catch(() => null)) as {
    schema?: unknown
    summary?: string
    confidence?: number
  } | null
  if (!body || !body.schema || typeof body.schema !== 'object') {
    return NextResponse.json({ error: 'A proposed schema is required.' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await createQuestionnaireAI(ctxOrError, serviceKey, body.schema, {
      conclusion: (body.summary ?? '').trim() || `Authored a questionnaire for ${serviceKey}.`,
      confidence: typeof body.confidence === 'number' ? body.confidence : undefined,
    })
    return NextResponse.json({ result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
