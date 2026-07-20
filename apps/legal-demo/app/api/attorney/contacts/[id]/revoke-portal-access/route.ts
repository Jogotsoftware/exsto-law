import { NextResponse } from 'next/server'
import { getContact, revokeClientPortalAccess } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { deleteAuthUserByEmail } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

// A2.3 — attorney-triggered removal of a client's portal access. Two layers,
// run in order:
//   1. The substrate-side revoke (revokeClientPortalAccess): deactivates the
//      mapped portal actor + archives the client_contact. This is what
//      actually blocks a future sign-in — see api/portalAccess.ts.
//   2. Best-effort Auth-side cleanup (deleteAuthUserByEmail): removes the
//      GoTrue user so a later re-invite to the same email doesn't collide
//      with a stale password. Runs AFTER step 1 succeeds, and its own
//      failure doesn't undo step 1 — the substrate write is the source of
//      truth for "does this person have access," not the Auth account.
//
// A dedicated route (not the generic attorney MCP dispatcher) because
// deleteAuthUserByEmail touches the service-role Supabase Auth Admin API,
// which lib/supabaseAdmin.ts quarantines to a narrow set of routes (hard
// rule 9) — it must never be reachable through the general-purpose MCP tool
// surface.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: contactEntityId } = await params
  if (!contactEntityId?.trim()) {
    return NextResponse.json({ error: 'contactEntityId is required.' }, { status: 400 })
  }

  const ctxOrError = await resolveAttorneyCtx(request)
  if ('error' in ctxOrError) {
    return NextResponse.json({ error: ctxOrError.error }, { status: ctxOrError.status })
  }

  try {
    const contact = await getContact(ctxOrError, contactEntityId)
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    }

    const revoked = await revokeClientPortalAccess(ctxOrError, contactEntityId)

    let authDeleted = false
    if (contact.email) {
      try {
        const r = await deleteAuthUserByEmail(contact.email)
        authDeleted = r.deleted
      } catch (authError) {
        // Substrate revoke already succeeded and is authoritative — log-and-
        // continue rather than report a false failure to the attorney.
        console.error('[revoke-portal-access] Auth cleanup failed:', authError)
      }
    }

    return NextResponse.json({ ok: true, ...revoked, authDeleted })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
