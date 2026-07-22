import { NextResponse } from 'next/server'
import { getContact, isAdmin, revokeClientPortalAccess } from '@exsto/legal'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { deleteAuthUserByEmail } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

// Users & Roles portal tab — delete a portal user's LOGIN ONLY (Joe 2026-07-21:
// "login only, keep CRM contact"). Sibling of revoke-portal-access with one
// difference: archiveContact:false, so the person stays in the CRM. The mapped
// portal actor goes inactive (mintClientSession refuses it directly via
// isPortalAccessRevoked) and the GoTrue login is removed. Re-inviting from the
// contact page restores access (legal.client.restore_portal_access).
//
// A dedicated route (not the attorney MCP dispatcher) because
// deleteAuthUserByEmail touches the service-role Supabase Auth Admin API,
// which lib/supabaseAdmin.ts quarantines to a narrow set of routes.
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
    // A user-management surface: admin only (unlike the any-attorney CRM revoke).
    if (!(await isAdmin(ctxOrError))) {
      return NextResponse.json({ error: 'Only a firm admin can manage users.' }, { status: 403 })
    }
    const contact = await getContact(ctxOrError, contactEntityId)
    if (!contact) {
      return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
    }

    const revoked = await revokeClientPortalAccess(ctxOrError, contactEntityId, {
      archiveContact: false,
    })

    let authDeleted = false
    if (contact.email) {
      try {
        const r = await deleteAuthUserByEmail(contact.email)
        authDeleted = r.deleted
      } catch (authError) {
        // Substrate revoke already succeeded and is authoritative — log-and-
        // continue rather than report a false failure to the attorney.
        console.error('[delete-portal-login] Auth cleanup failed:', authError)
      }
    }

    return NextResponse.json({ ok: true, ...revoked, authDeleted })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
