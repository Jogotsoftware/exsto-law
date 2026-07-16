import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import {
  signStagedUploadToken,
  filterReferencedObjectKeys,
  INTAKE_STAGING_SEGMENT,
} from '@exsto/legal'
import { checkPublicRateLimit, clientIpFrom } from '@/lib/rateLimit'
import { resolvePublicTenant, FirmNotFoundError } from '@/lib/publicTenant'
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  isAllowedMime,
  safeFilename,
  uploadObject,
  removeObject,
  listIntakeStagingObjects,
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
// Anti-abuse posture: a DEDICATED per-IP bucket (namespaced so uploads can't
// starve the booking flow's own budget) plus the size/type caps bound what an
// anonymous caller can stage; staged bytes are inert (unreferenced, unreadable)
// until a captcha-gated booking submit claims them; and the sweep below deletes
// stale UNREFERENCED staging objects so abandonment/abuse can't accumulate
// storage forever. The captcha itself stays on the submit: Turnstile tokens are
// single-use, and spending one per attached file would break the one-solve
// booking flow.
export const runtime = 'nodejs'

// MULTI-TENANT-1: tenant + system actor resolved SERVER-SIDE per request from the
// firm the funnel is on (hard rule 9 — never from the request body). The staged
// object key and its token bind to THAT tenant, and finalize verifies the token
// under the same resolved tenant. See lib/publicTenant.ts.

// ---- Staging orphan sweep (amortized GC) -----------------------------------
// Every staged object is either claimed by a booking (its key lands on a
// document_version — binding never moves bytes) or abandoned. Abandoned objects
// must not live forever, so each upload opportunistically sweeps: list the
// oldest staging objects, keep anything younger than the grace window (2× the
// 24h token TTL, so a token can never outlive its object) or referenced by ANY
// document_version (tenant-scoped substrate read), delete the rest. Throttled
// per process; racing sweeps across instances just re-delete already-gone keys
// (removeObject is idempotent best-effort).
const SWEEP_INTERVAL_MS = 10 * 60_000
const SWEEP_MIN_AGE_MS = 48 * 60 * 60 * 1000
let lastSweepMs = 0

// Sweeps the RESOLVED tenant's staging (the tenant that just uploaded), so orphan
// GC follows the firm rather than a single hardcoded tenant. The throttle is
// process-global (best-effort GC); under multi-tenant load a given window sweeps
// whichever tenant's upload won the throttle — acceptable for opportunistic GC.
function maybeSweepStagingOrphans(tenantId: string, actorId: string): void {
  const now = Date.now()
  if (now - lastSweepMs < SWEEP_INTERVAL_MS) return
  lastSweepMs = now
  void (async () => {
    try {
      const objects = await listIntakeStagingObjects(tenantId)
      const stale = objects.filter(
        (o) => o.createdAt && now - new Date(o.createdAt).getTime() > SWEEP_MIN_AGE_MS,
      )
      if (stale.length === 0) return
      const referenced = await filterReferencedObjectKeys(
        { tenantId, actorId },
        stale.map((o) => o.objectKey),
      )
      for (const o of stale) {
        if (!referenced.has(o.objectKey)) await removeObject(o.objectKey)
      }
    } catch {
      // best-effort: a failed sweep just leaves orphans for the next one
    }
  })()
}

export async function POST(request: Request) {
  // Namespaced bucket: an upload burst must not consume the booking/MCP flow's
  // own rate budget (they'd otherwise share one per-IP window).
  const rl = checkPublicRateLimit(`intake-upload:${clientIpFrom(request)}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please slow down and try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSeconds) } },
    )
  }

  let tenantId: string
  let actorId: string
  try {
    const pub = await resolvePublicTenant(request)
    tenantId = pub.tenantId
    actorId = pub.actorId
  } catch (e) {
    if (e instanceof FirmNotFoundError) {
      return NextResponse.json({ error: 'This firm could not be found.' }, { status: 404 })
    }
    throw e
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
  const objectKey = `${tenantId}/${INTAKE_STAGING_SEGMENT}/${randomUUID()}-${filename}`

  try {
    await uploadObject(objectKey, buffer, mime)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed.' },
      { status: 500 },
    )
  }
  maybeSweepStagingOrphans(tenantId, actorId)

  // The token is minted AFTER the bytes land so it always names a real object.
  // If signing fails (secret unset), remove the now-unreachable object — the
  // client sees a clear error instead of a dead token.
  try {
    const token = signStagedUploadToken({
      tenantId,
      objectKey,
      originalFilename: filename,
      contentType: mime,
      sizeBytes: buffer.length,
      sha256Hex,
    })
    return NextResponse.json({ ok: true, token, filename, sizeBytes: buffer.length })
  } catch (e) {
    await removeObject(objectKey)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload could not be recorded.' },
      { status: 500 },
    )
  }
}
