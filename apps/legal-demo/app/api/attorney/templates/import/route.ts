import { NextResponse } from 'next/server'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { readSessionFromCookieHeader } from '@/lib/session'

// Template import: parse an uploaded document to plain text the Templates builder
// drops into the editor. This is stateless parsing — it touches NO substrate
// table, so it lives as an app route (not an MCP tool). Attorney-gated exactly
// like the MCP route: a verified session cookie in prod, dev-only header fallback.
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
      const result = await mammoth.extractRawText({ buffer })
      text = result.value ?? ''
    } else if (name.endsWith('.doc')) {
      return NextResponse.json(
        { error: 'Legacy .doc isn’t supported — save it as .docx or PDF and try again.' },
        { status: 415 },
      )
    } else {
      // .txt / .md / .html / anything text-like.
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
