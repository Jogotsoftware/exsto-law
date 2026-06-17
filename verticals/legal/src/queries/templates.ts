import { withActionContext, type ActionContext } from '@exsto/substrate'

// Standalone templates read layer (beta sprint Obj 9). A standalone template is a
// `template` entity (document or email) not bound to a service — the firm's
// reusable library. These reads back the Templates tab editor and feed the
// aggregate catalog (templatesCatalog.ts).

export type StandaloneTemplateCategory = 'document' | 'email'

export interface StandaloneTemplate {
  templateEntityId: string
  name: string
  category: StandaloneTemplateCategory
  body: string
  docKind: string | null
  updatedAt: string
}

type TemplateRow = {
  template_entity_id: string
  name: string | null
  category: string | null
  body: string | null
  doc_kind: string | null
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
