import { NextResponse } from 'next/server'
import { readSessionFromCookieHeader } from '@/lib/session'
import { DocumentParseError, parseUploadedDocument } from '@/lib/parseDocument'

// Template import: parse an uploaded document into markdown the Templates builder
// drops into the editor, via the shared parseUploadedDocument helper (the same
// parser the assistant chat's attach-a-document upload uses). This is stateless
// parsing — it touches NO substrate table, so it lives as an app route (not an MCP
// tool). Attorney-gated exactly like the MCP route: a verified session cookie in
// prod, dev-only headers.
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
    return NextResponse.json({ text })
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
