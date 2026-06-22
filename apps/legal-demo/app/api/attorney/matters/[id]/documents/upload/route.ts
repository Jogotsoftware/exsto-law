import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { resolveAttorneyCtx } from '@/lib/attorneySession'
import { getMatter, recordUploadedDocument } from '@exsto/legal'
import '@exsto/legal' // register the document.upload action handler (side effect)
import {
  MAX_UPLOAD_BYTES,
  sniffMime,
  isAllowedMime,
  safeFilename,
  uploadObject,
  removeObject,
} from '@/lib/documentStorage'

// Upload a file to a matter. Multipart (can't ride the JSON MCP transport), so
// it's a dedicated route — but tenancy is identical to the MCP route: the tenant
// comes from the SIGNED cookie via resolveAttorneyCtx, never the request body.
// Flow: auth → matter ownership (RLS-scoped read) → size cap → server-sniff MIME
// (+ allowlist) → upload bytes to Storage → record the substrate document. On a
// record failure the just-uploaded object is removed (orphan cleanup).
export const runtime = 'nodejs'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: matterId } = await params
  const ctx = await resolveAttorneyCtx(request)
  if ('error' in ctx) return NextResponse.json({ error: ctx.error }, { status: ctx.status })

  // Tenancy gate: the matter must belong to the caller's tenant (RLS-scoped read
  // returns null otherwise). This is the load-bearing check, not the path param.
  const matter = await getMatter(ctx, matterId).catch(() => null)
  if (!matter) return NextResponse.json({ error: 'Matter not found.' }, { status: 404 })

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
  const mime = sniffMime(buffer, file.name || '')
  if (!mime || !isAllowedMime(mime)) {
    return NextResponse.json(
      { error: 'Unsupported file type. Allowed: PDF, Word, images (PNG/JPG/TIFF), text.' },
      { status: 415 },
    )
  }
  const filename = safeFilename(file.name || 'document')
  const sha256Hex = createHash('sha256').update(buffer).digest('hex')
  // Tenant-prefixed key so a leaked key can't cross tenants and the prefix is auditable.
  const objectKey = `${ctx.tenantId}/${matterId}/${randomUUID()}-${filename}`

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
    })
    return NextResponse.json({ ok: true, documentVersionId: rec.documentVersionId })
  } catch (e) {
    // The bytes are up but the substrate record failed — remove the orphan.
    await removeObject(objectKey)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Failed to record the document.' },
      { status: 500 },
    )
  }
}
