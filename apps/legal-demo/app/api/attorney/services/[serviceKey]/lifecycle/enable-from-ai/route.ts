import { NextResponse } from 'next/server'
import { setServiceActive } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// Enable-proposal APPROVE route (Build-Wizard Phase 6 — the TERMINAL step) — THE HUMAN
// GATE that makes a wizard-built service actually LIVE. The chat turn that proposes
// Enable writes NOTHING: it only captures the proposal as the final approval card. The
// live status flip happens ONLY here, when the attorney clicks Approve, which calls
// legal.service.set_active(true) — flipping the service's CURRENT version from the
// disabled-draft status ('deprecated') to 'active'. This is the step the old wizard
// never reached (it punted Enable to "the editor"), which is exactly why the founder's
// wizard-built service stayed a hidden draft and its templates/questionnaire pages —
// which read the ACTIVE version — showed nothing.
//
// Sourced to the ATTORNEY (going live is the attorney's own decision, not the agent's),
// resolved from the signed session (never the request body). The set_active handler
// re-checks completeness and rejects an enable on an incomplete service, so this can
// never publish a half-built service even if the model proposed it early.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ serviceKey: string }> },
) {
  const { serviceKey } = await params
  if (!serviceKey) {
    return NextResponse.json({ error: 'serviceKey is required' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    // active=true flips the current version to 'active' (the enable gate runs in the
    // handler). After this the service is bookable and its template/questionnaire
    // pages — which read the active version — resolve its data.
    const result = await setServiceActive(ctxOrError, serviceKey, true)
    return NextResponse.json({
      result,
      serviceKey,
      // The build is done — point the attorney at the live service.
      link: `/attorney/services/${encodeURIComponent(serviceKey)}`,
      label: `Service "${serviceKey}" (live)`,
      // WP4: the REAL public booking URL for this service — the same link the
      // attorney shares with clients. The card renders a real button for it, so it
      // never depends on a model-typed link (which routed to "/").
      bookingLink: `/book?service=${encodeURIComponent(serviceKey)}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
