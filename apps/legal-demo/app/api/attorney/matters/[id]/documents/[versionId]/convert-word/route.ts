import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import {
  getUploadedDocumentObject,
  extractDocumentText,
  UnreviewableDocumentError,
} from '@exsto/legal'
import { downloadObject, safeFilename } from '@/lib/documentStorage'
import { renderDocumentHtml } from '@/lib/documentHtml'

// "Download as Word" for an uploaded document (WP-B2, founder-approved real
// conversion): extract text/structure server-side (same extractor the AI
// review already uses), render it through the SAME markdown→HTML the drafts
// use (lib/documentHtml.ts), and wrap it in the same MS-Office-namespaced
// HTML-as-.doc trick apps/legal-demo/lib/draftExport.ts's downloadAsWord uses
// client-side for drafts — duplicated here (small, ~20 lines) rather than
// importing that module, which is 'window'/'document'-coupled and not meant
// to run on the server. Honest, formatting-lossy conversion — the filename
// says so. Same auth + matter-scoped IDOR guard as the sibling routes.
export const runtime = 'nodejs'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const PRINT_STYLES = `
  body { font-family: Georgia, 'Times New Roman', serif; max-width: 7in; margin: 1in auto; line-height: 1.7; color: #111; font-size: 11pt; }
  h1 { font-size: 18pt; margin: 0 0 14pt; text-align: center; }
  h2 { font-size: 14pt; margin: 22pt 0 10pt; }
  h3 { font-size: 12pt; margin: 18pt 0 8pt; }
  p  { margin: 0 0 10pt; }
  ul, ol { margin: 0 0 10pt 22pt; padding: 0; }
  li { margin-bottom: 4pt; }
  strong { font-weight: 700; }
  em { font-style: italic; }
`

function stripExtension(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i > 0 ? filename.slice(0, i) : filename
}

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

  let text: string
  try {
    text = await extractDocumentText(bytes, obj.contentType)
  } catch (err) {
    const status = err instanceof UnreviewableDocumentError ? 415 : 422
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not convert this file.' },
      { status },
    )
  }

  const title = `${stripExtension(obj.filename)} (Converted copy)`
  const bodyHtml = renderDocumentHtml(text)
  const fullHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}</style></head>
<body>${bodyHtml}</body>
</html>`
  // BOM + msword mime, same trick draftExport.downloadAsWord uses client-side.
  const out = Buffer.from('﻿' + fullHtml, 'utf8')
  const filename = safeFilename(`${title}.doc`)
  return new NextResponse(new Uint8Array(out), {
    status: 200,
    headers: {
      'Content-Type': 'application/msword',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(out.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
