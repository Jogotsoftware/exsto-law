import { withActionContext, type ActionContext } from '@exsto/substrate'

// Question library read layer (migration 0077). A question_template is a single
// reusable intake question (an entity, not service config) carrying a stable
// {{answer}} token. The firm's question bank — addable to any questionnaire via
// the "Add from library" picker. Mirrors the questionnaire-library reads.

export interface QuestionTemplate {
  questionTemplateId: string
  label: string
  // One of KnownFieldType (text/textarea/select/date/number/yes_no/true_false/checkbox/…).
  type: string
  // The stable {{answer}} key this question fills in templates. Reused as the
  // field id wherever the question is added.
  token: string
  // Choices for select / checkbox questions; null otherwise.
  options: string[] | null
  updatedAt: string
}

type QtRow = {
  question_template_id: string
  label: string | null
  type: string | null
  token: string | null
  // jsonb → node-postgres returns a parsed value (array) or null.
  options: string[] | null
  updated_at: Date
}

const QT_SELECT = `
  SELECT
    e.id AS question_template_id,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'question_template_label' ORDER BY a.valid_from DESC LIMIT 1) AS label,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'question_template_type' ORDER BY a.valid_from DESC LIMIT 1)  AS type,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'question_template_token' ORDER BY a.valid_from DESC LIMIT 1) AS token,
    (SELECT a.value FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'question_template_options' ORDER BY a.valid_from DESC LIMIT 1)        AS options,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'question_template'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapQt(r: QtRow): QuestionTemplate {
  return {
    questionTemplateId: r.question_template_id,
    label: r.label ?? '',
    type: r.type ?? 'text',
    token: r.token ?? '',
    options: Array.isArray(r.options) ? r.options : null,
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listQuestionTemplates(ctx: ActionContext): Promise<QuestionTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<QtRow>(`${QT_SELECT} ORDER BY label`, [ctx.tenantId])
    return res.rows.map(mapQt)
  })
}

export async function getQuestionTemplate(
  ctx: ActionContext,
  questionTemplateId: string,
): Promise<QuestionTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<QtRow>(`${QT_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      questionTemplateId,
    ])
    return res.rows[0] ? mapQt(res.rows[0]) : null
  })
}

// The set of {{answer}} tokens already in the library — used to keep new tokens
// unique so a template merge-field binds to exactly one question.
export async function listQuestionTokens(ctx: ActionContext): Promise<Set<string>> {
  const all = await listQuestionTemplates(ctx)
  return new Set(all.map((q) => q.token).filter(Boolean))
}
