import { NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import '@exsto/legal/mcp'
import { isClientContactActive } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { sniffMime, uploadObject } from '@/lib/documentStorage'

// CLIENT proof-of-payment screenshot upload (manual payment reporting, migration
// 0115). Multipart (can't ride the JSON MCP transport), so it's a dedicated route
// — same trust model as the portal document upload: identity ONLY from the signed
// httpOnly session cookie, size cap → magic-byte sniff (IMAGES ONLY here — a
// payment proof is a screenshot, so PDF/Word are refused) → the quarantined
// Storage module. The object lands under a tenant-prefixed payment-reports key;
// the browser gets back only that opaque key, which it passes to
// legal.client.report_payment — the report handler re-checks the tenant prefix,
// and the attorney reads the bytes through the attorney-gated download route.
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Screenshots are small; 8 MB tolerates a full-page retina capture.
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024
const IMAGE_EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg' }

export async function POST(request: Request) {
  // Per-IP budget (own namespace so it can't starve other portal budgets).
  const rate = checkPublicRateLimit(`payment-screenshot:${clientIpFrom(request)}`)
  if (!rate.allowed) {
    return NextResponse.json({ error: 'Too many uploads — try again shortly.' }, { status: 429 })
  }

  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    return NextResponse.json({ error: 'Screenshot too large (max 8 MB).' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buffer, file.name || '')
  const ext = mime ? IMAGE_EXT[mime] : undefined
  if (!ext) {
    return NextResponse.json({ error: 'Screenshots must be PNG or JPG images.' }, { status: 415 })
  }

  const key = `payment-reports/${tenantId}/${randomUUID()}.${ext}`
  try {
    await uploadObject(key, buffer, mime!)
  } catch {
    return NextResponse.json({ error: 'Upload failed — try again.' }, { status: 502 })
  }
  return NextResponse.json({ key })
}
