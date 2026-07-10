import { NextResponse } from 'next/server'
import { createServiceAI, type WorkflowRoute, type GenerationMode } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// New-service-proposal APPROVE route (Build-Wizard Phase 1) — THE HUMAN GATE. The
// chat turn that proposes a new service writes NOTHING: it only captures the
// proposal as an inline card. The live version-1 (disabled) write happens ONLY here,
// when the attorney clicks Approve. This is a THIN adapter over the operation core:
// it resolves the tenant from the signed session (never the request body), then
// delegates to createServiceAI — which persists a reasoning_trace and submits
// legal.service.upsert AS THE CLAUDE AGENT ACTOR (intent 'exploration', trace
// attached). It never touches the substrate directly.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    displayName?: string
    description?: string | null
    route?: WorkflowRoute
    generationMode?: GenerationMode
    appointmentRequired?: boolean
    summary?: string
    confidence?: number
  } | null
  const displayName = (body?.displayName ?? '').trim()
  if (!displayName) {
    return NextResponse.json({ error: 'A service display name is required.' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const result = await createServiceAI(
      ctxOrError,
      {
        displayName,
        description: body?.description ?? null,
        route: body?.route,
        generationMode: body?.generationMode,
        ...(typeof body?.appointmentRequired === 'boolean'
          ? { appointmentRequired: body.appointmentRequired }
          : {}),
      },
      {
        conclusion: (body?.summary ?? '').trim() || `Created the service "${displayName}".`,
        confidence: typeof body?.confidence === 'number' ? body.confidence : undefined,
      },
    )
    // Return the LINK to the created service so the chat can show "View service →"
    // AND auto-continue the guided build (Phase 6 continuous flow). serviceKey + a
    // short label ride along so the continuation message reads naturally.
    const serviceKey = result.serviceKey
    return NextResponse.json({
      result,
      serviceKey,
      link: `/attorney/services/${encodeURIComponent(serviceKey)}`,
      label: `Service "${displayName}"`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
