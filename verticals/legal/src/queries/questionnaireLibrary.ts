import { withActionContext, type ActionContext } from '@exsto/substrate'

// Questionnaire library read layer (migration 0067). A questionnaire_template is a
// reusable intake form (an entity, not service config) — the firm's library,
// attachable to any service. Mirrors the standalone template reads.

// Prefixed to avoid colliding with templates/loader.ts's QuestionnaireField /
// QuestionnaireSection (both re-exported from the vertical barrel).
export interface QLibField {
  id: string
  label?: string
  type?: string
  required?: boolean
  options?: string[]
}
export interface QLibSection {
  id?: string
  title?: string
  fields?: QLibField[]
}
export interface QuestionnaireSchema {
  id?: string
  version?: number
  title?: string
  sections: QLibSection[]
}

// A document template this questionnaire feeds (migration 0109).
export interface AssociatedTemplate {
  templateEntityId: string
  name: string | null
}

export interface QuestionnaireTemplate {
  questionnaireTemplateId: string
  name: string
  description: string | null
  schema: QuestionnaireSchema
  fieldCount: number
  // The document template(s) this questionnaire feeds (questionnaire_feeds_template).
  associatedTemplates: AssociatedTemplate[]
  updatedAt: string
}

type QtRow = {
  questionnaire_template_id: string
  name: string | null
  description: string | null
  // jsonb → node-postgres returns a parsed object (or null).
  schema: QuestionnaireSchema | null
  associated_templates: AssociatedTemplate[] | null
  updated_at: Date
}

const QT_SELECT = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id AS questionnaire_template_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'questionnaire_template_name')        AS name,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'questionnaire_template_description') AS description,
    (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'questionnaire_template_schema')               AS schema,
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'templateEntityId', t.id,
        'name', (SELECT value #>> '{}' FROM attrs WHERE entity_id = t.id AND kind_name = 'template_name')
      ) ORDER BY t.created_at), '[]'::jsonb)
     FROM relationship r
     JOIN relationship_kind_definition rk ON rk.id = r.relationship_kind_id
       AND rk.kind_name = 'questionnaire_feeds_template'
     JOIN entity t ON t.id = r.target_entity_id AND t.status = 'active'
     WHERE r.tenant_id = $1 AND r.source_entity_id = e.id
       AND (r.valid_to IS NULL OR r.valid_to > now()))                                                            AS associated_templates,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'questionnaire_template'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapQt(r: QtRow): QuestionnaireTemplate {
  const schema: QuestionnaireSchema = r.schema ?? { sections: [] }
  const fieldCount = (schema.sections ?? []).reduce((n, s) => n + (s.fields?.length ?? 0), 0)
  return {
    questionnaireTemplateId: r.questionnaire_template_id,
    name: r.name ?? '',
    description: r.description,
    schema,
    fieldCount,
    associatedTemplates: r.associated_templates ?? [],
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listQuestionnaireTemplates(
  ctx: ActionContext,
): Promise<QuestionnaireTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<QtRow>(`${QT_SELECT} ORDER BY name`, [ctx.tenantId])
    return res.rows.map(mapQt)
  })
}

export async function getQuestionnaireTemplate(
  ctx: ActionContext,
  questionnaireTemplateId: string,
): Promise<QuestionnaireTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<QtRow>(`${QT_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      questionnaireTemplateId,
    ])
    return res.rows[0] ? mapQt(res.rows[0]) : null
  })
}
