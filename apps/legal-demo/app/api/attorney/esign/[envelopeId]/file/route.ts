import { NextResponse } from 'next/server'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { loadEnvelopeFileRef, executedPdfObjectKey } from '@exsto/legal'
import { downloadObject } from '@/lib/documentStorage'

// 0170 — attorney view of a FILE envelope's document: streams the uploaded PDF
// behind the attorney session. The envelope id is resolved under the caller's
// tenant (RLS), so a foreign id simply resolves to nothing. Proxy-stream only —
// no signed Storage URL reaches the browser.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ envelopeId: string }> },
) {
  const { envelopeId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const ref = await loadEnvelopeFileRef(ctx, envelopeId).catch(() => null)
  if (!ref) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
  try {
    // ES-2 (§5.4) — prefer the stamped executed copy once it exists (derived
    // key, written on completion); the original streams until then.
    const bytes = await downloadObject(executedPdfObjectKey(ref.objectKey)).catch(() =>
      downloadObject(ref.objectKey),
    )
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': ref.contentType,
        'Content-Disposition': `inline; filename="${ref.filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'The file is no longer available.' }, { status: 404 })
  }
}
