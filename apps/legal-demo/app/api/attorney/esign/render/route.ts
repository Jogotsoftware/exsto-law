import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { loadVersionForPlacement, renderMarkdownForPlacement } from '@exsto/legal'
import { downloadObject } from '@/lib/documentStorage'

// ESIGN-UNIFY-1 ES-2 (§5.2) — the placement canvas's document source. Given a
// document_version id (tenant-scoped; a foreign id resolves to 404):
//   • uploaded PDF  → the stored bytes, no markers (nothing to anchor).
//   • markdown draft → the EXACT export-pipeline PDF (renderDraftPdf) plus the
//     §5.2 marker map, so template-authored {{type:key}} anchors pre-seed the
//     canvas as already-placed boxes the attorney adjusts.
// Response is JSON with base64 PDF bytes — one shape for both sources, and the
// marker map has nowhere to ride on a raw byte stream.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const body = (await request.json().catch(() => ({}))) as { documentVersionId?: string }
  const documentVersionId = typeof body.documentVersionId === 'string' ? body.documentVersionId : ''
  if (!documentVersionId) {
    return NextResponse.json({ error: 'documentVersionId is required.' }, { status: 400 })
  }

  const source = await loadVersionForPlacement(ctx, documentVersionId).catch(() => null)
  if (!source) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })

  try {
    if (source.kind === 'file') {
      if (source.contentType !== 'application/pdf') {
        return NextResponse.json({ error: 'Only PDF documents can be placed on.' }, { status: 415 })
      }
      const bytes = await downloadObject(source.objectKey)
      return NextResponse.json({
        pdf: bytes.toString('base64'),
        markers: [],
        source: 'file',
        filename: source.filename,
      })
    }
    const rendered = await renderMarkdownForPlacement(source)
    return NextResponse.json({
      pdf: rendered.pdf.toString('base64'),
      markers: rendered.markers,
      source: 'draft',
      filename: source.title,
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Could not render the document.' },
      { status: 500 },
    )
  }
}
