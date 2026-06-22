import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getUploadedDocumentObject } from '@exsto/legal'
import { downloadObject, safeFilename } from '@/lib/documentStorage'

// Download an uploaded document. The route PROXY-STREAMS the bytes (never hands a
// signed URL or the service-role key to the browser): auth from the signed cookie
// → the version must be `document_of` THIS matter (IDOR guard; RLS also scopes the
// tenant) → fetch bytes server-side → return them as a forced ATTACHMENT with a
// neutral content-type so an uploaded HTML/SVG can never render inline (stored-XSS).
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id: matterId, versionId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // The version id alone is NOT trusted: it must be an uploaded document of the
  // matter in the path. A version from another matter (even same tenant) → null → 404.
  const obj = await getUploadedDocumentObject(ctx, matterId, versionId).catch(() => null)
  if (!obj) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  let bytes: Buffer
  try {
    bytes = await downloadObject(obj.objectKey)
  } catch {
    return NextResponse.json({ error: 'Document bytes unavailable.' }, { status: 502 })
  }

  const filename = safeFilename(obj.filename)
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
