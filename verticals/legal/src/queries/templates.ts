import { withActionContext, type ActionContext } from '@exsto/substrate'

// Standalone templates read layer (beta sprint Obj 9). A standalone template is a
// `template` entity (document or email) not bound to a service — the firm's
// reusable library. These reads back the Templates tab editor and feed the
// aggregate catalog (templatesCatalog.ts).

export type StandaloneTemplateCategory = 'document' | 'email'

// Typed metadata for a single {{token}}. Stored as part of the template_variables
// JSON attribute, keyed by token id (see migration 0076). Types align 1:1 with
// the intake questionnaire's field types so a template can generate a typed form.
export type TemplateVariableType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'number'
  | 'currency'
  | 'boolean'
  | 'choice'

export interface TemplateVariableSpec {
  type: TemplateVariableType
  required?: boolean
  default?: string
  options?: string[] // for type 'choice'
}

// Keyed by lowercased token id, e.g. { client_name: { type: 'text', required: true } }.
export type TemplateVariables = Record<string, TemplateVariableSpec>

export interface StandaloneTemplate {
  templateEntityId: string
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind: string | null
  variables: TemplateVariables
  updatedAt: string
}

type TemplateRow = {
  template_entity_id: string
  name: string | null
  category: string | null
  body: string | null
  doc_kind: string | null
  variables: TemplateVariables | null
  updated_at: Date
}

const TEMPLATE_SELECT = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id AS template_entity_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_name')     AS name,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_category') AS category,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_body')     AS body,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'template_doc_kind') AS doc_kind,
    -- json attribute: take the value as-is (the pg driver parses jsonb to an object).
    (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'template_variables')         AS variables,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'template'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapTemplate(r: TemplateRow): StandaloneTemplate {
  return {
    templateEntityId: r.template_entity_id,
    name: r.name ?? '',
    category: r.category === 'email' ? 'email' : 'document',
    body: r.body ?? '',
    docKind: r.doc_kind,
    variables: r.variables ?? {},
    updatedAt: r.updated_at.toISOString(),
  }
}

export async function listStandaloneTemplates(ctx: ActionContext): Promise<StandaloneTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(`${TEMPLATE_SELECT} ORDER BY name`, [ctx.tenantId])
    return res.rows.map(mapTemplate)
  })
}

export async function getStandaloneTemplate(
  ctx: ActionContext,
  templateEntityId: string,
): Promise<StandaloneTemplate | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TemplateRow>(`${TEMPLATE_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      templateEntityId,
    ])
    return res.rows[0] ? mapTemplate(res.rows[0]) : null
  })
}
