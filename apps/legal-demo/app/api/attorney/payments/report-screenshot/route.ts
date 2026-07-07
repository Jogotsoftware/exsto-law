import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { downloadObject } from '@/lib/documentStorage'

// Attorney view of a client's proof-of-payment screenshot (manual payment
// reporting, migration 0115). PROXY-STREAMS the bytes behind the attorney
// session — no signed URL, no service-role key in the browser. The key must sit
// under THIS tenant's payment-reports prefix (a foreign key 404s, so the route is
// no oracle for other tenants' objects). Only sniffed PNG/JPG ever lands under
// that prefix (the portal upload route enforces it), so serving the image inline
// is safe — nosniff plus an image content-type derived from the extension.
export const runtime = 'nodejs'

export async function GET(request: Request) {
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const key = new URL(request.url).searchParams.get('key') ?? ''
  const prefix = `payment-reports/${ctx.tenantId}/`
  if (!key.startsWith(prefix) || key.includes('..')) {
    return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 })
  }

  let bytes: Buffer
  try {
    bytes = await downloadObject(key)
  } catch {
    return NextResponse.json({ error: 'Screenshot not found.' }, { status: 404 })
  }

  const contentType = key.endsWith('.png') ? 'image/png' : 'image/jpeg'
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': 'inline; filename="payment-proof"',
      'Content-Length': String(bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
