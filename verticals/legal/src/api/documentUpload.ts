// Document-upload operation-core API. The bytes live in Supabase Storage; these
// functions own the SUBSTRATE side (record the document via the action layer;
// read a matter's uploads; resolve a version's object key under a strict
// matter-ownership check). Reads are tenant-scoped through executeQuery/RLS;
// the write flows through submitAction (hard rule 1). No object key is ever
// returned to the client by the list; bytes/keys are server-side only.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

export interface RecordUploadInput {
  matterEntityId: string
  objectKey: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  sha256Hex: string
  documentKind?: string
}

export async function recordUploadedDocument(
  ctx: ActionContext,
  input: RecordUploadInput,
): Promise<{ documentEntityId: string; documentVersionId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'document.upload',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      object_key: input.objectKey,
      original_filename: input.originalFilename,
      content_type: input.contentType,
      size_bytes: input.sizeBytes,
      sha256_hex: input.sha256Hex,
      document_kind: input.documentKind,
    },
  })
  const eff = res.effects[0] as { documentEntityId: string; documentVersionId: string }
  return { documentEntityId: eff.documentEntityId, documentVersionId: eff.documentVersionId }
}

export interface UploadedDocItem {
  documentVersionId: string
  documentEntityId: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  documentKind: string
  uploadedAt: string
}

// A matter's uploaded documents (document_of the matter), newest first. Lean:
// metadata only — never the object key or bytes.
export async function listMatterDocuments(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<UploadedDocItem[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      document_version_id: string
      document_entity_id: string
      original_filename: string | null
      content_type: string | null
      size_bytes: string | null
      document_kind: string | null
      uploaded_at: string
    }>(
      `SELECT dv.id AS document_version_id,
              e.id  AS document_entity_id,
              dv.metadata->>'original_filename' AS original_filename,
              dv.metadata->>'content_type'      AS content_type,
              dv.metadata->>'size_bytes'        AS size_bytes,
              COALESCE(e.metadata->>'document_kind', 'uploaded') AS document_kind,
              dv.recorded_at AS uploaded_at
         FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = e.id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE dv.tenant_id = $1
          AND r.target_entity_id = $2
          AND rkd.kind_name = 'document_of'
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map((row) => ({
      documentVersionId: row.document_version_id,
      documentEntityId: row.document_entity_id,
      originalFilename: row.original_filename ?? 'document',
      contentType: row.content_type ?? 'application/octet-stream',
      sizeBytes: row.size_bytes ? Number(row.size_bytes) : 0,
      documentKind: row.document_kind ?? 'uploaded',
      uploadedAt: row.uploaded_at,
    }))
  })
}

// Resolve a version's storage object key — but ONLY if that version is an
// uploaded document of THIS matter (document_of). The matterEntityId equality is
// the load-bearing IDOR guard: RLS already scopes to ctx.tenant, so this also
// blocks a same-tenant version id from a DIFFERENT matter. Returns null → 404.
export async function getUploadedDocumentObject(
  ctx: ActionContext,
  matterEntityId: string,
  documentVersionId: string,
): Promise<{ objectKey: string; contentType: string; filename: string } | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      object_key: string | null
      content_type: string | null
      original_filename: string | null
    }>(
      `SELECT dv.metadata->>'object_key'        AS object_key,
              dv.metadata->>'content_type'      AS content_type,
              dv.metadata->>'original_filename' AS original_filename
         FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = e.id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE dv.tenant_id = $1
          AND dv.id = $2
          AND r.target_entity_id = $3
          AND rkd.kind_name = 'document_of'
          AND (r.valid_to IS NULL OR r.valid_to > now())
        LIMIT 1`,
      [ctx.tenantId, documentVersionId, matterEntityId],
    )
    const row = res.rows[0]
    if (!row?.object_key) return null
    return {
      objectKey: row.object_key,
      contentType: row.content_type ?? 'application/octet-stream',
      filename: row.original_filename ?? 'document',
    }
  })
}
