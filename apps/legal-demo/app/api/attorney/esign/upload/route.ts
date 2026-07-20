import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, getContact, recordUploadedDocument } from '@exsto/legal'
import '@exsto/legal' // register the document.upload action handler (side effect)
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  safeFilename,
  uploadObject,
  removeObject,
} from '@/lib/documentStorage'

// 0170 — upload a PDF to send for e-signature (the "e-sign any document" door).
// Unlike the matter upload route, the matter is OPTIONAL: the document can stand
// alone, or be filed under a matter and/or an existing contact chosen in the
// wizard. PDF-only (this is the signing lane, not general document storage).
// Tenancy comes from the SIGNED cookie via resolveAttorneyCtx, never the body.
export const runtime = 'nodejs'

export async function POST(request: Request) {
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const matterId = typeof form?.get('matterId') === 'string' ? String(form.get('matterId')) : ''
  const contactId = typeof form?.get('contactId') === 'string' ? String(form.get('contactId')) : ''
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded.' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'The file is empty.' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File too large (max 25 MB).' }, { status: 413 })
  }

  // Attachment targets must belong to the caller's tenant (RLS-scoped reads).
  if (matterId) {
    const matter = await getMatter(ctx, matterId).catch(() => null)
    if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })
  }
  if (contactId) {
    const contact = await getContact(ctx, contactId).catch(() => null)
    if (!contact) return NextResponse.json({ error: 'Contact not found.' }, { status: 404 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(buffer, file.name || '')
  if (mime !== 'application/pdf') {
    return NextResponse.json(
      { error: 'Only PDF files can be sent for signature.' },
      { status: 415 },
    )
  }
  const filename = safeFilename(file.name || 'document.pdf')
  const sha256Hex = createHash('sha256').update(buffer).digest('hex')
  // Matter uploads live under the matter prefix (same as the matter upload
  // route); standalone envelopes get their own auditable esign prefix.
  const objectKey = matterId
    ? `${ctx.tenantId}/${matterId}/${randomUUID()}-${filename}`
    : `${ctx.tenantId}/esign/${randomUUID()}-${filename}`

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
      matterEntityId: matterId || null,
      attachContactEntityId: contactId || null,
      objectKey,
      originalFilename: filename,
      contentType: mime,
      sizeBytes: buffer.length,
      sha256Hex,
      documentKind: 'esign_upload',
    })
    return NextResponse.json({
      ok: true,
      documentVersionId: rec.documentVersionId,
      documentEntityId: rec.documentEntityId,
      filename,
    })
  } catch (e) {
    // The bytes are up but the substrate record failed — remove the orphan.
    await removeObject(objectKey)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to record the document.' },
      { status: 500 },
    )
  }
}
