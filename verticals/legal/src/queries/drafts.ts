import { withActionContext, type ActionContext } from '@exsto/substrate'

export interface PendingDraftSummary {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
}

export interface DraftDetail extends PendingDraftSummary {
  bodyMarkdown: string
  reasoningTrace: Record<string, unknown> | null
  modelIdentity: string | null
  conclusion: string | null
  confidence: number | null
  reviewNotes: string | null
}

export async function listPendingDraftVersions(ctx: ActionContext): Promise<PendingDraftSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
    }>(
      `SELECT
         dv.id AS version_id,
         dv.document_entity_id,
         r.source_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         coalesce(dv.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS recorded_at
       FROM document_version dv
       JOIN relationship r ON r.target_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.source_entity_id
       WHERE dv.tenant_id = $1
         AND rkd.kind_name = 'matter_has_document'
         AND dv.status = 'pending_review'
       ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((row) => ({
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
    }))
  })
}

export async function getDraftVersion(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<DraftDetail | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
      body: string
      reasoning_trace_id: string | null
      model_identity: string | null
    }>(
      `SELECT
         dv.id AS version_id,
         dv.document_entity_id,
         r.source_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         coalesce(dv.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS recorded_at,
         cb.body,
         dv.reasoning_trace_id,
         dv.metadata->>'model_identity' AS model_identity
       FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
       JOIN relationship r ON r.target_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.source_entity_id
       WHERE dv.tenant_id = $1
         AND dv.id = $2
         AND rkd.kind_name = 'matter_has_document'
       LIMIT 1`,
      [ctx.tenantId, documentVersionId],
    )
    const row = res.rows[0]
    if (!row) return null

    let reasoningTrace: Record<string, unknown> | null = null
    let conclusion: string | null = null
    let confidence: number | null = null
    if (row.reasoning_trace_id) {
      const traceRes = await client.query<{
        trace: Record<string, unknown>
        conclusion: string
        confidence: string
      }>(
        `SELECT trace, conclusion, confidence::text AS confidence
         FROM reasoning_trace
         WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, row.reasoning_trace_id],
      )
      const t = traceRes.rows[0]
      if (t) {
        reasoningTrace = t.trace
        conclusion = t.conclusion
        confidence = Number(t.confidence)
      }
    }

    const notesRes = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1
         AND a.entity_id = $2
         AND akd.kind_name = 'document_review_notes'
       ORDER BY a.valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, row.document_entity_id],
    )

    return {
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      bodyMarkdown: row.body,
      reasoningTrace,
      modelIdentity: row.model_identity,
      conclusion,
      confidence,
      reviewNotes: notesRes.rows[0]?.value ?? null,
    }
  })
}
