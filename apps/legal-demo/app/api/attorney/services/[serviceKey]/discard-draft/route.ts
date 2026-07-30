import { NextResponse } from 'next/server'
import { getService, listServicesIncludingInactive, retireService } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'

export const runtime = 'nodejs'

// SB-FIX-1 (4) — "Leave and discard draft" from the builder's quiet ⋯ menu.
//
// A guided build creates its service shell on the FIRST approval, as a disabled
// draft, and everything after that hangs off it. Abandoning a build therefore used
// to leave a half-built service behind in the firm's Services list forever, with no
// offer to clean it up — the attorney had to go find it. This is that cleanup.
//
// It retires the service through the action layer (legal.service.retire — seals the
// current version, status 'deprecated', retired: true). Substrate rows are never hard
// deleted; retiring is the archive.
//
// GUARD: only a service that is NOT live may be discarded here. Taking down a service
// clients can already book is a different decision with different consequences, and it
// belongs on the service's own page behind its own confirmation — not on a menu whose
// other two items are freely reversible.
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
    // getService is active-only, so a hit here means the service is LIVE — refuse.
    if (await getService(ctxOrError, serviceKey)) {
      return NextResponse.json(
        { error: 'That service is live. Take it down from its own page instead of discarding it.' },
        { status: 409 },
      )
    }
    // Confirm the draft actually exists before retiring, so a stale client key
    // reports honestly instead of silently succeeding.
    const all = await listServicesIncludingInactive(ctxOrError)
    if (!all.some((s) => s.serviceKey === serviceKey)) {
      return NextResponse.json({ error: 'No such service draft.' }, { status: 404 })
    }
    await retireService(ctxOrError, serviceKey)
    return NextResponse.json({ ok: true, serviceKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to discard the draft service.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
