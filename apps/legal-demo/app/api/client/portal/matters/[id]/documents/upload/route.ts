import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import '@exsto/legal/mcp'
import { recordUploadedDocument, isClientContactActive } from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  isAllowedMime,
  safeFilename,
  uploadObject,
  removeObject,
} from '@/lib/documentStorage'

// CLIENT document upload to one of the client's OWN matters. Multipart (can't ride
// the JSON MCP transport), so it's a dedicated route — but it reproduces the authed
// client-portal trust model exactly: identity comes ONLY from the signed httpOnly
// session cookie, and the matter in the path must be one the client is client_of
// (a miss returns the SAME 404 as 'no such matter' — no oracle). The byte path is
// identical to the attorney upload and reuses the quarantined Storage module; the
// substrate record is written with CLIENT provenance (ADR 0035), so history shows
// the client uploaded it, and the attorney sees it badged "Uploaded by client".
export const runtime = 'nodejs'
// RUNTIME-AUTORUN-2: a client upload here can advance the matter onto a producing stage
// (generate_document) whose autorun drafts the document synchronously in this request
// (post-commit, off the advance txn, but still in-request). Allow the model budget so
// the will/document draft does not time out.
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params

  // Identity + tenancy from the SIGNED cookie only (never the body/path/headers).
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }
  const { clientContactId, tenantId, matterIds, clientActorId } = session
  if (
    !UUID_RE.test(clientContactId) ||
    !UUID_RE.test(tenantId) ||
    !UUID_RE.test(clientActorId)
  ) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  // Live re-check: a deactivated contact can't keep uploading on an unexpired cookie.
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }
  // Per-matter authz: the path matter must be one this client is client_of. A miss
  // is the SAME 404 as 'no such matter' (no oracle for another client's matter).
  if (!UUID_RE.test(matterId) || !matterIds.includes(matterId)) {
    return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })
  }
  // PORTAL-1: the upload is attributed to the client's OWN actor (from the
  // signed session), not the shared public-intake system actor.
  const ctx = { tenantId, actorId: clientActorId }

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
  const objectKey = `${tenantId}/${matterId}/${randomUUID()}-${filename}`

  try {
    await uploadObject(objectKey, buffer, mime)
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Upload failed.' },
      { status: 500 },
    )
  }

  try {
    const rec = await recordUploadedDocument(ctx, {
      matterEntityId: matterId,
      objectKey,
      originalFilename: filename,
      contentType: mime,
      sizeBytes: buffer.length,
      sha256Hex,
      documentSource: 'client_uploaded',
      clientContactId,
    })
    return NextResponse.json({ ok: true, documentVersionId: rec.documentVersionId })
  } catch (e) {
    // Bytes are up but the substrate record failed — remove the orphan object.
    await removeObject(objectKey)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to record the document.' },
      { status: 500 },
    )
  }
}
