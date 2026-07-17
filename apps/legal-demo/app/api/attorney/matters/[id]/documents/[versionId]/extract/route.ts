import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import {
  getUploadedDocumentObject,
  extractDocumentText,
  UnreviewableDocumentError,
} from '@exsto/legal'
import { downloadObject } from '@/lib/documentStorage'

// Extract an uploaded document's text/structure server-side (WP-B2 conversions).
// Reuses the SAME extractor the AI document review already uses
// (verticals/legal/src/api/reviewDocument.ts) — one extraction path, not a
// parallel one. Powers the client's "Download as PDF" for non-PDF uploads
// (extract → existing print-based downloadAsPdf); "Download as Word" instead
// hits ./convert-word, which does the same extraction server-side and returns
// the finished .doc directly. Same auth + matter-scoped IDOR guard as the
// sibling download route: a version id from another matter resolves to 404.
export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  const { id: matterId, versionId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const obj = await getUploadedDocumentObject(ctx, matterId, versionId).catch(() => null)
  if (!obj) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  let bytes: Buffer
  try {
    bytes = await downloadObject(obj.objectKey)
  } catch {
    return NextResponse.json({ error: 'Document bytes unavailable.' }, { status: 502 })
  }

  try {
    const text = await extractDocumentText(bytes, obj.contentType)
    return NextResponse.json({ text, filename: obj.filename, contentType: obj.contentType })
  } catch (err) {
    if (err instanceof UnreviewableDocumentError) {
      return NextResponse.json({ error: err.message }, { status: 415 })
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not extract text from this file.' },
      { status: 422 },
    )
  }
}
