import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { signStagedUploadToken, INTAKE_STAGING_SEGMENT } from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  isAllowedMime,
  safeFilename,
  uploadObject,
} from '@/lib/documentStorage'

// PUBLIC intake-upload STAGING route for /book file_upload questionnaire fields.
// Multipart (can't ride the JSON MCP transport), so it's a dedicated route.
// There is no matter yet at this point in the wizard, so unlike the portal
// upload there is nothing to authorize against — instead the byte path is
// identical (size cap → magic-byte sniff → quarantined Storage module) and the
// object lands under a tenant-prefixed STAGING key that nothing reads until
// legal.booking.submit verifies the signed token this route returns and binds
// the object to the just-created matter via document.upload. The browser only
// ever holds that opaque token — never the object key, never a Storage URL.
//
// Anti-abuse posture: the shared per-IP limiter plus the size/type caps bound
// what an anonymous caller can stage; staged bytes are inert (unreferenced,
// unreadable) until a captcha-gated booking submit claims them, and tokens
// expire in 24h so abandoned staging objects are sweepable orphans. The
// captcha itself stays on the submit: Turnstile tokens are single-use, and
// spending one per attached file would break the one-solve booking flow.
export const runtime = 'nodejs'

// Tenant is resolved SERVER-SIDE only (hard rule 9) — same env as the client
// MCP route; never from the request.
const TENANT_ID = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

export async function POST(request: Request) {
  const rl = checkPublicRateLimit(clientIpFrom(request))
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 25 MB).' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  // Server-side MIME sniff over magic bytes — the browser file.type is never trusted.
  const mime = sniffMime(buffer, file.name || '')
  if (!mime || !isAllowedMime(mime)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Allowed: PDF, Word, images (PNG/JPG/TIFF), text.' },
      { status: 415 },
    )
  }
  const filename = safeFilename(file.name || 'document')
  const sha256Hex = createHash('sha256').update(buffer).digest('hex')
  const objectKey = `${TENANT_ID}/${INTAKE_STAGING_SEGMENT}/${randomUUID()}-${filename}`

  try {
    await uploadObject(objectKey, buffer, mime)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed.' },
      { status: 500 },
    )
  }

  // The token is minted AFTER the bytes land so it always names a real object.
  // If signing fails (secret unset), the staged object is an unreferenced
  // orphan — benign, and the client sees a clear error instead of a dead token.
  try {
    const token = signStagedUploadToken({
      tenantId: TENANT_ID,
      objectKey,
      originalFilename: filename,
      contentType: mime,
      sizeBytes: buffer.length,
      sha256Hex,
    })
    return NextResponse.json({ ok: true, token, filename, sizeBytes: buffer.length })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload could not be recorded.' },
      { status: 500 },
    )
  }
}
