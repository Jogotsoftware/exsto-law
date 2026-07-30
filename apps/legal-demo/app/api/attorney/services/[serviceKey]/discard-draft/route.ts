import { NextResponse } from 'next/server'
import { getService, retireService } from '@exsto/legal'
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
    // getService returns the current version whatever its status (it filters on
    // valid_to, not on active), so read isActive explicitly rather than treating a
    // hit as "live" — a disabled draft is exactly what this route is for.
    const service = await getService(ctxOrError, serviceKey)
    if (!service) {
      return NextResponse.json({ error: 'No such service draft.' }, { status: 404 })
    }
    if (service.isActive) {
      return NextResponse.json(
        { error: 'That service is live. Take it down from its own page instead of discarding it.' },
        { status: 409 },
      )
    }
    await retireService(ctxOrError, serviceKey)
    return NextResponse.json({ ok: true, serviceKey })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to discard the draft service.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
