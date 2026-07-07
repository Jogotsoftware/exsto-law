import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// READ-ONLY Supabase Storage access for worker-side jobs that must consume an
// uploaded matter document's bytes (AI document review). Quarantine mirrors the
// Claude adapter ("the only module allowed to talk to X") and the app's
// documentStorage module: this is the ONLY vertical/worker file permitted to
// read SUPABASE_SERVICE_ROLE_KEY, it uses the privileged client EXCLUSIVELY for
// Storage downloads (never PostgREST tables — hard rule 9's actual prohibition;
// substrate access flows through DATABASE_URL + RLS), and it exposes no upload,
// remove, or signed-URL surface. A guard test
// (tests/invariants/vertical-storage-guard.test.ts) enforces all three.
//
// Why the vertical needs its own adapter at all: uploads/downloads on request
// paths live in apps/legal-demo (the app injects them where a route is the
// caller), but the review job runs in the WORKER process, which never imports
// the app. Handlers still take the download as an injected dependency — tests
// pass fakes; only the worker registration wires this real adapter.

const BUCKET = 'matter-documents'

let cached: SupabaseClient | null = null
function storageClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    // Fail loudly at first use: the worker deploy (Render) must carry both vars
    // for document review to run; a silent empty download would be worse.
    throw new Error(
      'Worker document storage is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on the worker deploy).',
    )
  }
  if (!cached) cached = createClient(url, serviceKey, { auth: { persistSession: false } })
  return cached
}

// Download one object's bytes. The CALLER is responsible for resolving the key
// through a matter-scoped substrate read (getUploadedDocumentObject) — this
// adapter never decides what may be read, it only fetches.
export async function downloadMatterDocument(objectKey: string): Promise<Buffer> {
  const { data, error } = await storageClient().storage.from(BUCKET).download(objectKey)
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'no data'}`)
  return Buffer.from(await data.arrayBuffer())
}
