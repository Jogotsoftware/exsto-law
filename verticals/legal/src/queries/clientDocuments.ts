import { withActionContext, type ActionContext } from '@exsto/substrate'
import { resolveClientMatterIds } from '../api/clientIdentity.js'

// CLIENT-SAFE document reads for the authenticated portal. Like queries/clientBilling.ts,
// kept separate so the projection is easy to audit: scoped to the client's OWN
// matters (client_of), and never exposes attorney-internal fields (reasoning trace,
// model identity, confidence, review notes) or storage object keys.

export interface ApprovedClientDocument {
  documentVersionId: string
  documentKind: string
  matterNumber: string
  versionNumber: number
  approvedAt: string
}

export interface ClientUploadedDocument {
  documentVersionId: string
  originalFilename: string
  contentType: string
  sizeBytes: number
  matterNumber: string
  uploadedAt: string
}

// The attorney-APPROVED document drafts on the signed-in client's matters — the
// "documents your attorney has prepared for you." One row per document (its latest
// approved version), newest first. The client reads the body via the existing
// client-safe shared-draft surface (/d/[versionId] → legal.draft.get_shared); this
// list deliberately carries NO body and none of the internal fields.
export async function listApprovedClientDocuments(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ApprovedClientDocument[]> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_kind: string
      matter_number: string
      version_number: number
      approved_at: string
    }>(
      `SELECT DISTINCT ON (dv.document_entity_id)
         dv.id AS version_id,
         coalesce(e_doc.metadata->>'document_kind', 'document') AS document_kind,
         e_matter.name AS matter_number,
         dv.version_number,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS approved_at
       FROM document_version dv
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND rkd.kind_name = 'draft_of'
         AND r.target_entity_id = ANY($2::uuid[])
         AND dv.status = 'approved'
       ORDER BY dv.document_entity_id, dv.version_number DESC`,
      [ctx.tenantId, matterIds],
    )
    return res.rows
      .map((row) => ({
        documentVersionId: row.version_id,
        documentKind: row.document_kind,
        matterNumber: row.matter_number,
        versionNumber: row.version_number,
        approvedAt: row.approved_at,
      }))
      .sort((a, b) => (a.approvedAt < b.approvedAt ? 1 : -1))
  })
}

// The documents the signed-in client has UPLOADED (document_of their matters,
// document_source='client_uploaded'), newest first. Metadata only — never the
// storage object key. A confirmation surface so the client can see what they shared.
export async function listClientUploadedDocuments(
  ctx: ActionContext,
  clientContactId: string,
): Promise<ClientUploadedDocument[]> {
  const matterIds = await resolveClientMatterIds(ctx.tenantId, clientContactId)
  if (matterIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      original_filename: string | null
      content_type: string | null
      size_bytes: string | null
      matter_number: string
      uploaded_at: string
    }>(
      `SELECT dv.id AS version_id,
              dv.metadata->>'original_filename' AS original_filename,
              dv.metadata->>'content_type'      AS content_type,
              dv.metadata->>'size_bytes'        AS size_bytes,
              e_matter.name AS matter_number,
              to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS uploaded_at
         FROM document_version dv
         JOIN entity e_doc ON e_doc.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
         JOIN entity e_matter ON e_matter.id = r.target_entity_id
        WHERE dv.tenant_id = $1
          AND rkd.kind_name = 'document_of'
          AND r.target_entity_id = ANY($2::uuid[])
          AND dv.metadata->>'document_source' = 'client_uploaded'
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId, matterIds],
    )
    return res.rows.map((row) => ({
      documentVersionId: row.version_id,
      originalFilename: row.original_filename ?? 'document',
      contentType: row.content_type ?? 'application/octet-stream',
      sizeBytes: row.size_bytes ? Number(row.size_bytes) : 0,
      matterNumber: row.matter_number,
      uploadedAt: row.uploaded_at,
    }))
  })
}
