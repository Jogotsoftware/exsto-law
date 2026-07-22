import { withActionContext, type ActionContext } from '@exsto/substrate'

// Attorney-facing document aggregation across a SET of matters — the
// client/contact Documents tab (every document on every matter that person is
// on). Two lanes, mirroring the matter Documents tab:
//   • generated — attorney work product, related draft_of a matter (latest
//     version per document entity);
//   • uploaded  — files related document_of a matter.
// Each row is tagged with its matter so the tab can group/label. Attorney view,
// so nothing is filtered the way the client-safe clientDocuments.ts filters
// (memos and e-sign docs are shown — the attorney sees everything).

export type PersonDocumentSource = 'generated' | 'uploaded'

export interface PersonDocumentItem {
  documentVersionId: string
  documentEntityId: string
  source: PersonDocumentSource
  title: string
  documentKind: string
  /** Uploaded lane only: bytes + content type for the file row; 0/'' for generated. */
  contentType: string
  sizeBytes: number
  status: string
  versionNumber: number | null
  matterEntityId: string
  matterNumber: string
  recordedAt: string
}

// All documents across the given matters, newest first. Empty set → [] (no query).
export async function listDocumentsForMatters(
  ctx: ActionContext,
  matterEntityIds: string[],
): Promise<PersonDocumentItem[]> {
  if (matterEntityIds.length === 0) return []
  return withActionContext(ctx, async (client) => {
    // Generated documents: draft_of a matter, latest version per document entity.
    const generated = await client.query<{
      document_version_id: string
      document_entity_id: string
      document_kind: string
      status: string
      version_number: number
      matter_id: string
      matter_number: string
      recorded_at: string
    }>(
      `SELECT DISTINCT ON (dv.document_entity_id)
         dv.id AS document_version_id,
         dv.document_entity_id,
         coalesce(e_doc.metadata->>'document_kind', 'document') AS document_kind,
         dv.status,
         dv.version_number,
         e_matter.id AS matter_id,
         e_matter.name AS matter_number,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at
       FROM document_version dv
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND rkd.kind_name = 'draft_of'
         AND r.target_entity_id = ANY($2::uuid[])
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY dv.document_entity_id, dv.version_number DESC`,
      [ctx.tenantId, matterEntityIds],
    )

    // Uploaded documents: document_of a matter, one row per version (files).
    const uploaded = await client.query<{
      document_version_id: string
      document_entity_id: string
      original_filename: string | null
      content_type: string | null
      size_bytes: string | null
      document_kind: string | null
      matter_id: string
      matter_number: string
      recorded_at: string
    }>(
      `SELECT dv.id AS document_version_id,
              e.id  AS document_entity_id,
              dv.metadata->>'original_filename' AS original_filename,
              dv.metadata->>'content_type'      AS content_type,
              dv.metadata->>'size_bytes'        AS size_bytes,
              COALESCE(e.metadata->>'document_kind', 'uploaded') AS document_kind,
              e_matter.id AS matter_id,
              e_matter.name AS matter_number,
              to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at
         FROM document_version dv
         JOIN entity e ON e.id = dv.document_entity_id
         JOIN relationship r ON r.source_entity_id = e.id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
         JOIN entity e_matter ON e_matter.id = r.target_entity_id
        WHERE dv.tenant_id = $1
          AND rkd.kind_name = 'document_of'
          AND r.target_entity_id = ANY($2::uuid[])
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId, matterEntityIds],
    )

    const rows: PersonDocumentItem[] = [
      ...generated.rows.map((r) => ({
        documentVersionId: r.document_version_id,
        documentEntityId: r.document_entity_id,
        source: 'generated' as const,
        title: humanizeKind(r.document_kind),
        documentKind: r.document_kind,
        contentType: '',
        sizeBytes: 0,
        status: r.status,
        versionNumber: r.version_number,
        matterEntityId: r.matter_id,
        matterNumber: r.matter_number,
        recordedAt: r.recorded_at,
      })),
      ...uploaded.rows.map((r) => ({
        documentVersionId: r.document_version_id,
        documentEntityId: r.document_entity_id,
        source: 'uploaded' as const,
        title: r.original_filename ?? 'document',
        documentKind: r.document_kind ?? 'uploaded',
        contentType: r.content_type ?? 'application/octet-stream',
        sizeBytes: r.size_bytes ? Number(r.size_bytes) : 0,
        status: 'uploaded',
        versionNumber: null,
        matterEntityId: r.matter_id,
        matterNumber: r.matter_number,
        recordedAt: r.recorded_at,
      })),
    ]
    // Newest first across both lanes.
    rows.sort((a, b) => (a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0))
    return rows
  })
}

// Turn a snake_case document_kind into a title ("operating_agreement" → "Operating Agreement").
function humanizeKind(kind: string): string {
  return kind
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}
