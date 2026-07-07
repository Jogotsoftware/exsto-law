// Server-only Supabase Storage access for matter document uploads. This is the
// ONLY module that touches the service-role key, and it uses it EXCLUSIVELY for
// the Storage API (never the substrate Postgres tables — hard rule 9; substrate
// access flows through DATABASE_URL + RLS elsewhere). A guard test
// (tests/invariants/document-upload-guard.test.ts) enforces both invariants.
//
// The key is read from SUPABASE_SERVICE_ROLE_KEY (server-only; no NEXT_PUBLIC_),
// so it is never bundled to the browser. All upload/download flows through the two
// attorney-gated Next routes; the browser never gets the key or a raw object URL.
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const DOCUMENTS_BUCKET = 'matter-documents'
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024 // 25 MB

// Allowed (server-SNIFFED) MIME types. The browser-supplied file.type is never
// trusted for what we store/serve.
const ALLOWED_MIME = new Set<string>([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword', // legacy .doc
  'image/png',
  'image/jpeg',
  'image/tiff',
  'text/plain',
])

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime)
}

// Sniff the real MIME from magic bytes (+ extension only to disambiguate ZIP/text
// containers). Returns null when unrecognized → the route rejects it.
export function sniffMime(buf: Buffer, filename: string): string | null {
  const at = (i: number) => buf[i]
  const starts = (sig: number[]) => sig.every((b, i) => at(i) === b)
  if (starts([0x25, 0x50, 0x44, 0x46])) return 'application/pdf' // %PDF
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (starts([0x49, 0x49, 0x2a, 0x00]) || starts([0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff'
  if (starts([0xd0, 0xcf, 0x11, 0xe0])) return 'application/msword' // OLE2 (.doc)
  if (starts([0x50, 0x4b, 0x03, 0x04])) {
    // ZIP container (docx/xlsx/pptx all share it) — accept only as .docx by ext.
    return /\.docx$/i.test(filename)
      ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : null
  }
  if (/\.txt$/i.test(filename)) return 'text/plain'
  return null
}

// A safe storage basename: strip any path, allowlist chars, cap length. The
// `{uuid}-` prefix in the object key already guarantees uniqueness, so this is
// purely cosmetic and is sanitized aggressively (no `/` → no prefix escape).
export function safeFilename(name: string): string {
  const base = (name || 'document').split(/[\\/]/).pop() || 'document'
  const cleaned = base
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 120)
  return cleaned.replace(/^[._]+/, '') || 'document'
}

let cached: SupabaseClient | null = null
function storageClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error(
      'Document storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).',
    )
  }
  if (!cached) cached = createClient(url, serviceKey, { auth: { persistSession: false } })
  return cached
}

export async function uploadObject(
  objectKey: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { error } = await storageClient()
    .storage.from(DOCUMENTS_BUCKET)
    .upload(objectKey, body, { contentType, upsert: false })
  if (error) throw new Error(`Storage upload failed: ${error.message}`)
}

export async function removeObject(objectKey: string): Promise<void> {
  try {
    await storageClient().storage.from(DOCUMENTS_BUCKET).remove([objectKey])
  } catch {
    // best-effort orphan cleanup; a tenant-prefixed unreferenced object is benign
  }
}

// Oldest-first listing of a tenant's intake-staging objects, for the
// reference-aware orphan sweep in the intake uploads route. List-only —
// deletion composes from removeObject, and the ROUTE (not this module) decides
// what is deletable by checking substrate references, so the service-role
// client here still never touches a DB table.
export async function listIntakeStagingObjects(
  tenantId: string,
  limit = 200,
): Promise<Array<{ objectKey: string; createdAt: string | null }>> {
  const prefix = `${tenantId}/intake-staging`
  const { data, error } = await storageClient()
    .storage.from(DOCUMENTS_BUCKET)
    .list(prefix, { limit, sortBy: { column: 'created_at', order: 'asc' } })
  if (error || !data) return []
  return data
    .filter((o) => !!o.name)
    .map((o) => ({
      objectKey: `${prefix}/${o.name}`,
      createdAt: (o as { created_at?: string | null }).created_at ?? null,
    }))
}

// Server-side fetch of the bytes for the proxy-stream download. No signed URL is
// ever issued to the browser.
export async function downloadObject(objectKey: string): Promise<Buffer> {
  const { data, error } = await storageClient().storage.from(DOCUMENTS_BUCKET).download(objectKey)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}
