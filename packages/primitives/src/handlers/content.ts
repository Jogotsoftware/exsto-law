// Content & document write paths. content_blob is content-addressed (sha256);
// document_version is immutable and auto-incremented per document entity.
import { randomUUID, createHash } from 'crypto'
import { registerActionHandler } from '@exsto/substrate'

registerActionHandler('content_blob.store', async (ctx, client, payload, actionId) => {
  const p = payload as { content_type: string; body: string }
  const sha = createHash('sha256').update(p.body, 'utf8').digest()
  const id = randomUUID()
  await client.query(
    `INSERT INTO content_blob (id, tenant_id, action_id, content_type, body, sha256, size_bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, ctx.tenantId, actionId, p.content_type, p.body, sha, Buffer.byteLength(p.body, 'utf8')],
  )
  return { contentBlobId: id, sha256: sha.toString('hex') }
})

registerActionHandler('document.add_version', async (ctx, client, payload, actionId) => {
  const p = payload as {
    document_entity_id: string
    content_blob_id: string
    status?: string
    reasoning_trace_id?: string
    metadata?: Record<string, unknown>
  }
  const next = await client.query<{ n: number }>(
    `SELECT COALESCE(max(version_number), 0) + 1 AS n FROM document_version
      WHERE tenant_id = $1 AND document_entity_id = $2`,
    [ctx.tenantId, p.document_entity_id],
  )
  const versionNumber = next.rows[0]!.n
  const id = randomUUID()
  await client.query(
    `INSERT INTO document_version (id, tenant_id, action_id, document_entity_id, content_blob_id, version_number, status, reasoning_trace_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      id,
      ctx.tenantId,
      actionId,
      p.document_entity_id,
      p.content_blob_id,
      versionNumber,
      p.status ?? 'pending_review',
      p.reasoning_trace_id ?? null,
      JSON.stringify(p.metadata ?? {}),
    ],
  )
  return { documentVersionId: id, versionNumber }
})
