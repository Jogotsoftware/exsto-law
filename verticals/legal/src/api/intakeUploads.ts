import { createHmac, timingSafeEqual } from 'node:crypto'

// HMAC-signed staged-upload token for the PUBLIC intake wizard (/book). A
// file_upload questionnaire field uploads its bytes immediately to a tenant-
// prefixed STAGING key in Storage; the route hands the browser this token —
// never the raw object key — and the token is round-tripped back on
// legal.booking.submit, where submitBooking verifies it and binds the object
// to the just-opened matter via document.upload. Same trust model as the
// booking-manage link: the payload is self-describing and tamper-proof, and
// the tenant is resolved from the SIGNED payload, never from the request.
//
// The prefix check in verify is load-bearing: a token can only ever name an
// object under `${tenantId}/intake-staging/`, so even a forged-or-leaked token
// can't bind an arbitrary Storage object (another matter's document, another
// tenant's file) into a matter.
//
// Fail-closed: a secret is REQUIRED. Same env chain as the booking-manage and
// e-sign tokens so no new env var is needed; domain-separated from both.

export interface StagedUploadTokenPayload {
  tenantId: string
  objectKey: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  sha256Hex: string
  /** Epoch ms expiry. */
  exp: number
}

function secret(): string {
  const s = process.env.ESIGN_SIGNING_SECRET ?? process.env.OAUTH_STATE_SECRET
  if (!s || s.length < 16) {
    throw new Error(
      'ESIGN_SIGNING_SECRET (or OAUTH_STATE_SECRET, ≥16 chars) is required to sign intake-upload tokens. ' +
        'Set it in .env.local / the deploy env.',
    )
  }
  return s
}

function mac(payloadB64: string): string {
  return createHmac('sha256', secret()).update(`intake-upload.${payloadB64}`).digest('base64url')
}

// Staged uploads are transient: the client uploads mid-wizard and submits the
// booking minutes later. 24h absorbs an abandoned tab resumed the next morning;
// anything older is an orphan for the staging GC to sweep.
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000

export const INTAKE_STAGING_SEGMENT = 'intake-staging'

export function signStagedUploadToken(
  payload: Omit<StagedUploadTokenPayload, 'exp'>,
  ttlMs: number = DEFAULT_TTL_MS,
  nowMs: number = Date.now(),
): string {
  const full: StagedUploadTokenPayload = { ...payload, exp: nowMs + ttlMs }
  const payloadB64 = Buffer.from(JSON.stringify(full)).toString('base64url')
  return `${payloadB64}.${mac(payloadB64)}`
}

// Verify the MAC (constant-time), the expiry, the tenant binding, and the
// staging-prefix constraint; returns the payload or throws.
export function verifyStagedUploadToken(
  token: string | null | undefined,
  expectedTenantId: string,
  nowMs: number = Date.now(),
): StagedUploadTokenPayload {
  if (!token || typeof token !== 'string') throw new Error('Missing uploaded-file reference.')
  const dot = token.indexOf('.')
  if (dot <= 0) throw new Error('This uploaded-file reference is invalid.')
  const payloadB64 = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = mac(payloadB64)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('This uploaded-file reference is invalid.')
  }
  let payload: StagedUploadTokenPayload
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf8'),
    ) as StagedUploadTokenPayload
  } catch {
    throw new Error('This uploaded-file reference is invalid.')
  }
  if (
    typeof payload.tenantId !== 'string' ||
    typeof payload.objectKey !== 'string' ||
    typeof payload.originalFilename !== 'string' ||
    typeof payload.contentType !== 'string' ||
    typeof payload.sizeBytes !== 'number' ||
    typeof payload.sha256Hex !== 'string' ||
    typeof payload.exp !== 'number'
  ) {
    throw new Error('This uploaded-file reference is invalid.')
  }
  if (payload.exp < nowMs) {
    throw new Error('An uploaded file has expired. Please re-attach it and submit again.')
  }
  if (payload.tenantId !== expectedTenantId) {
    throw new Error('This uploaded-file reference is invalid.')
  }
  if (!payload.objectKey.startsWith(`${payload.tenantId}/${INTAKE_STAGING_SEGMENT}/`)) {
    throw new Error('This uploaded-file reference is invalid.')
  }
  return payload
}
