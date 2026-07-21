import { NextResponse } from 'next/server'
import {
  loadEnvelopeFileRefForClient,
  executedPdfObjectKey,
  isClientContactActive,
  resolveClientMatterIds,
  loadClientContactEmail,
  type ClientPrincipal,
} from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { downloadObject } from '@/lib/documentStorage'

// Portal-session door for a client's SIGNING document view (0170 uploaded-PDF
// envelopes, ESIGN-ANY-DOC): mirrors /api/sign/file's token door — same
// ?requestId (there: ?token)/&doc=N shape, same executed-copy-preferred
// fallback, same no-signed-URL posture (bytes proxy through here) — but
// authorizes via the authenticated client-portal session instead of a signing
// token, so a portal client sees the uploaded PDF inline instead of a blank
// pane (SignDocument only renders isFile documents when it's given a fileUrl).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }

  const params = new URL(request.url).searchParams
  const requestId = params.get('requestId') ?? ''
  if (!UUID_RE.test(requestId)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  }
  // ES-MULTIDOC-1 — `?doc=N` selects one document in a multi-document envelope
  // (0-based, in send order). Absent ⇒ the primary (doc 0), unchanged.
  const docIndex = Math.max(0, Number.parseInt(params.get('doc') ?? '0', 10) || 0)

  // Same doctrine as esignPortalTools.ts's principal(): derive the signing
  // principal FRESH from the DB (never trust the session's cached email/matter
  // set for this authz-critical path), then let resolveClientEnvelopeId apply
  // the same fail-closed ownership test the load/sign/decline tools use.
  const [matterIds, email] = await Promise.all([
    resolveClientMatterIds(tenantId, clientContactId),
    loadClientContactEmail(tenantId, clientContactId),
  ])
  if (!email) {
    return NextResponse.json({ error: 'Could not resolve your account.' }, { status: 401 })
  }
  const principal: ClientPrincipal = { tenantId, clientContactId, email, matterIds }

  try {
    const ref = await loadEnvelopeFileRefForClient(principal, requestId, docIndex)
    if (!ref) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    // ES-2 (§5.4) — once the envelope completes, a stamped executed copy exists
    // beside the original (derived key); prefer it so a signer returning here
    // sees the executed document. Mid-flow it doesn't exist yet and the
    // original streams (the fallback).
    const bytes = await downloadObject(executedPdfObjectKey(ref.objectKey)).catch(() =>
      downloadObject(ref.objectKey),
    )
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': ref.contentType,
        'Content-Disposition': `inline; filename="${ref.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  }
}
