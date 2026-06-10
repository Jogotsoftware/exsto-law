import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'

export interface MatterSummary {
  matterEntityId: string
  matterNumber: string
  clientName: string
  practiceArea: string
  status: string
  summary: string
  createdAt: string
}

export interface MatterDetail extends MatterSummary {
  attributes: Record<string, unknown>
  questionnaireResponses: Record<string, unknown> | null
  transcriptText: string | null
  latestDraftVersionId: string | null
  latestDraftStatus: string | null
  clientEmail: string | null
}

export async function listMatters(ctx: ActionContext): Promise<MatterSummary[]> {
  return withActionContext(ctx, async (client) => {
    const rows = await client.query<{
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      practice_area: string | null
      status: string | null
      summary: string | null
      created_at: string
    }>(
      `WITH attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name)
           a.entity_id, akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1
         ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       )
       SELECT
         e.id AS matter_entity_id,
         e.name AS matter_number,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'client_name') AS client_name,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'practice_area') AS practice_area,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_status') AS status,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'matter_summary') AS summary,
         to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'matter'
         AND e.status = 'active'
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )
    return rows.rows.map((r) => ({
      matterEntityId: r.matter_entity_id,
      matterNumber: r.matter_number,
      clientName: r.client_name ?? '',
      practiceArea: r.practice_area ?? '',
      status: r.status ?? 'inquiry',
      summary: r.summary ?? '',
      createdAt: r.created_at,
    }))
  })
}

export async function getMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterDetail | null> {
  return withActionContext(ctx, async (client) => {
    const baseRes = await client.query<{
      id: string
      name: string
      created_at: string
    }>(
      `SELECT e.id, e.name, e.created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'matter'`,
      [ctx.tenantId, matterEntityId],
    )
    const base = baseRes.rows[0]
    if (!base) return null

    const attributes = await loadCurrentAttributes(client, ctx.tenantId, matterEntityId)
    const questionnaireResponses = await loadFirstRelatedAttributeValue<Record<string, unknown>>(
      client,
      ctx.tenantId,
      matterEntityId,
      'matter_has_questionnaire',
      'questionnaire_responses',
    )
    const transcriptText = await loadFirstRelatedAttributeValue<string>(
      client,
      ctx.tenantId,
      matterEntityId,
      'matter_has_transcript',
      'transcript_text',
    )
    const clientEmail = await loadFirstRelatedAttributeValue<string>(
      client,
      ctx.tenantId,
      matterEntityId,
      'matter_has_client',
      'contact_email',
    )

    const latestDraft = await client.query<{
      version_id: string
      status: string
    }>(
      `SELECT dv.id AS version_id, dv.status
       FROM document_version dv
       JOIN relationship r ON r.target_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       WHERE r.tenant_id = $1
         AND r.source_entity_id = $2
         AND rkd.kind_name = 'matter_has_document'
       ORDER BY dv.recorded_at DESC
       LIMIT 1`,
      [ctx.tenantId, matterEntityId],
    )

    return {
      matterEntityId,
      matterNumber: base.name,
      clientName: (attributes.client_name as string | undefined) ?? '',
      practiceArea: (attributes.practice_area as string | undefined) ?? '',
      status: (attributes.matter_status as string | undefined) ?? 'inquiry',
      summary: (attributes.matter_summary as string | undefined) ?? '',
      createdAt: base.created_at,
      attributes,
      questionnaireResponses: questionnaireResponses ?? null,
      transcriptText: transcriptText ?? null,
      latestDraftVersionId: latestDraft.rows[0]?.version_id ?? null,
      latestDraftStatus: latestDraft.rows[0]?.status ?? null,
      clientEmail: clientEmail ?? null,
    }
  })
}

async function loadCurrentAttributes(
  client: DbClient,
  tenantId: string,
  entityId: string,
): Promise<Record<string, unknown>> {
  const res = await client.query<{ kind_name: string; value: unknown }>(
    `SELECT DISTINCT ON (akd.kind_name) akd.kind_name, a.value
     FROM attribute a
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = $2
     ORDER BY akd.kind_name, a.valid_from DESC`,
    [tenantId, entityId],
  )
  const out: Record<string, unknown> = {}
  for (const row of res.rows) {
    out[row.kind_name] = row.value
  }
  return out
}

async function loadFirstRelatedAttributeValue<T>(
  client: DbClient,
  tenantId: string,
  sourceEntityId: string,
  relationshipKindName: string,
  attributeKindName: string,
): Promise<T | null> {
  const res = await client.query<{ value: T }>(
    `SELECT a.value
     FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     JOIN attribute a ON a.entity_id = r.target_entity_id
     JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE r.tenant_id = $1
       AND r.source_entity_id = $2
       AND rkd.kind_name = $3
       AND akd.kind_name = $4
     ORDER BY a.valid_from DESC
     LIMIT 1`,
    [tenantId, sourceEntityId, relationshipKindName, attributeKindName],
  )
  return res.rows[0]?.value ?? null
}
