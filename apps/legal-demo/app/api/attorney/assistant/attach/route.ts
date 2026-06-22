import { NextResponse } from 'next/server'
import { readSessionFromCookieHeader } from '@/lib/session'
import { DocumentParseError, parseUploadedDocument } from '@/lib/parseDocument'

// Assistant chat "attach a document": parse an uploaded file (PDF / Word / text)
// to plain text the chat sends to Claude as extra context. Stateless parsing —
// touches NO substrate table (the attached text rides along in the next chat turn
// and is recorded there) — so it's an app route, not an MCP tool. Attorney-gated
// like the other parse route: a verified session cookie in prod, dev headers locally.
export const runtime = 'nodejs'

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

  try {
    const text = await parseUploadedDocument(file)
    return NextResponse.json({ name: file.name || 'document', text })
  } catch (err) {
    if (err instanceof DocumentParseError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return NextResponse.json(
      { error: `Could not read the file: ${err instanceof Error ? err.message : String(err)}` },
      { status: 422 },
    )
  }
}
