import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import { getClientUploadedDocumentObject, isClientContactActive } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { downloadObject, safeFilename } from '@/lib/documentStorage'

// CLIENT-PORTAL-UI-1 (WP-4) — open one of the client's OWN uploads in-browser.
// Same trust model as the upload route: identity ONLY from the signed httpOnly
// cookie; the version must be a client-visible upload on one of the client's
// own matters (any other version — same tenant included — 404s, no oracle).
//
// Rendering rule: INLINE is allowed only for a fixed allowlist of safe mimes
// (pdf, images, plain text) with `CSP: sandbox` so nothing can ever script; any
// other type keeps the attorney route's posture — neutral content-type, forced
// attachment (an uploaded HTML/SVG must never render in the portal's origin).
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const INLINE_MIMES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'text/plain'])

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
) {
  const { versionId } = await params
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId, clientActorId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId) || !UUID_RE.test(clientActorId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }
  if (!UUID_RE.test(versionId)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  }

  const ctx = { tenantId, actorId: clientActorId }
  const obj = await getClientUploadedDocumentObject(ctx, clientContactId, versionId).catch(
    () => null,
  )
  if (!obj) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  let bytes: Buffer
  try {
    bytes = await downloadObject(obj.objectKey)
  } catch {
    return NextResponse.json({ error: 'Document bytes unavailable.' }, { status: 502 })
  }

  const filename = safeFilename(obj.filename)
  const mime = (obj.contentType ?? '').toLowerCase().split(';')[0]?.trim() ?? ''
  const forceDownload = new URL(request.url).searchParams.has('download')
  const inline = !forceDownload && INLINE_MIMES.has(mime)
  const headers: Record<string, string> = {
    'Content-Type': inline
      ? mime === 'text/plain'
        ? 'text/plain; charset=utf-8'
        : mime
      : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${filename}"`,
    'Content-Length': String(bytes.length),
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  }
  // Belt over braces for inline text: sandbox so a mislabeled payload can never
  // script. NOT applied to PDFs — CSP sandbox blocks the browser's PDF viewer.
  if (mime === 'text/plain') headers['Content-Security-Policy'] = 'sandbox'
  return new NextResponse(new Uint8Array(bytes), { status: 200, headers })
}
