import { NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { readSessionFromCookieHeader } from '@/lib/session'
import { htmlToMarkdown } from '@/lib/templateBody'

// Template import: parse an uploaded document into markdown the Templates builder
// drops into the editor. DOCX and HTML are converted STRUCTURALLY (headings,
// bold/italic, lists survive) via the same HTML→markdown bridge the editor uses;
// PDF and plain text come through as text. This is stateless parsing — it touches
// NO substrate table, so it lives as an app route (not an MCP tool). Attorney-gated
// exactly like the MCP route: a verified session cookie in prod, dev-only headers.
export const runtime = 'nodejs'

const MAX_BYTES = 10 * 1024 * 1024 // 10 MB

export async function POST(request: Request) {
  const isProd = process.env.NODE_ENV === 'production'
  const session = readSessionFromCookieHeader(request.headers.get('cookie'))
  const devHeaders =
    !isProd && Boolean(request.headers.get('x-actor-id') && request.headers.get('x-tenant-id'))
  if (!((session?.actorId && session?.tenantId) || devHeaders)) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File too large (max 10 MB).' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const name = (file.name || '').toLowerCase()
  const type = file.type || ''

  try {
    let text: string
    if (name.endsWith('.pdf') || type === 'application/pdf') {
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      const result = await parser.getText()
      text = result.text ?? ''
    } else if (
      name.endsWith('.docx') ||
      type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      // Structured: convert to HTML (preserving headings/bold/italic/lists), then
      // to markdown via the editor's bridge so the import matches what the editor
      // round-trips. (extractRawText would flatten all formatting to bare text.)
      const result = await mammoth.convertToHtml({ buffer })
      text = htmlToMarkdown(result.value ?? '')
    } else if (name.endsWith('.doc')) {
      return NextResponse.json(
        { error: 'Legacy .doc isn’t supported — save it as .docx or PDF and try again.' },
        { status: 415 },
      )
    } else if (name.endsWith('.html') || name.endsWith('.htm') || type === 'text/html') {
      // Structured HTML → markdown (same bridge), so an exported web/Word HTML
      // keeps its structure instead of dumping raw tags into the editor.
      text = htmlToMarkdown(buffer.toString('utf8'))
    } else {
      // .txt / .md / anything else text-like — already plain text or markdown.
      text = buffer.toString('utf8')
    }
    // Normalize line endings and collapse runs of blank lines for a clean paste.
    text = text
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    if (!text) {
      return NextResponse.json(
        {
          error:
            'No readable text found in that file (a scanned/image-only PDF has no text layer).',
        },
        { status: 422 },
      )
    }
    return NextResponse.json({ text })
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 },
    )
  }
}
