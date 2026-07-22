import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { getEngagementExecutedCopyRef, isClientContactActive } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { downloadObject, safeFilename } from '@/lib/documentStorage'

// ENGAGEMENT-DOC-1 — stream the signed-in client's OWN executed engagement
// agreement (the PDF stamped when they accepted in the gate). Identity ONLY from
// the signed httpOnly cookie; the copy is resolved by document_of_contact for
// THIS contact (getEngagementExecutedCopyRef), so it can never serve another
// client's agreement. A PDF, inline by default (?download forces attachment).
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request) {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId, clientActorId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId) || !UUID_RE.test(clientActorId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }

  const ctx = { tenantId, actorId: clientActorId }
  const ref = await getEngagementExecutedCopyRef(ctx, clientContactId).catch(() => null)
  if (!ref) return NextResponse.json({ error: 'No signed agreement yet.' }, { status: 404 })

  let bytes: Buffer
  try {
    bytes = await downloadObject(ref.objectKey)
  } catch {
    return NextResponse.json({ error: 'Document bytes unavailable.' }, { status: 502 })
  }

  const filename = safeFilename(ref.filename)
  const inline = !new URL(request.url).searchParams.has('download')
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
