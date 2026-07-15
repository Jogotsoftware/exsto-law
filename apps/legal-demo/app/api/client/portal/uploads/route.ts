import { NextResponse } from 'next/server'
import '@exsto/legal/mcp'
import {
  listClientUploadedDocuments,
  getClientUploadedDocumentObject,
  isClientContactActive,
} from '@exsto/legal'
import { readClientSessionFromCookieHeader } from '@/lib/clientSession'
import { objectExists } from '@/lib/documentStorage'

// S1 — the client's uploaded documents WITH a resolution flag. Same client-safe
// projection as legal.client.uploads, plus an `available` boolean computed in the
// app layer (the only place the service-role Storage client lives): true iff the
// entity's recorded object_key actually resolves to bytes in the bucket. The
// object_key itself never leaves the server — the browser only sees `available`,
// so it can render "no longer available" instead of a dead View/Download.
//
// Resolution stays single-path: availability and the View/Download route both go
// through the recorded document_version.object_key (getClientUploadedDocumentObject).
// There is no bucket-listing / convention resolver anywhere on the read path.
export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: Request): Promise<NextResponse> {
  const session = readClientSessionFromCookieHeader(request.headers.get('cookie'))
  if (!session) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { clientContactId, tenantId, clientActorId } = session
  if (!UUID_RE.test(clientContactId) || !UUID_RE.test(tenantId) || !UUID_RE.test(clientActorId)) {
    return NextResponse.json({ error: 'Invalid session.' }, { status: 401 })
  }
  if (!(await isClientContactActive(tenantId, clientContactId))) {
    return NextResponse.json({ error: 'Session no longer valid.' }, { status: 401 })
  }

  const ctx = { tenantId, actorId: clientActorId }
  const docs = await listClientUploadedDocuments(ctx, clientContactId)
  const documents = await Promise.all(
    docs.map(async (d) => {
      const obj = await getClientUploadedDocumentObject(
        ctx,
        clientContactId,
        d.documentVersionId,
      ).catch(() => null)
      const available = obj ? await objectExists(obj.objectKey) : false
      return { ...d, available }
    }),
  )
  return NextResponse.json({ documents })
}
