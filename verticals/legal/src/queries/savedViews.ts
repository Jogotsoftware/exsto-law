import { withActionContext, type ActionContext } from '@exsto/substrate'

// Saved views read layer (beta sprint Obj 5). A saved_view entity holds a named
// filter/sort view for a list surface (matters / contacts / review). Listed
// firm-wide; each carries its owner so a future multi-user build can filter to
// "mine" without a schema change. Optionally scoped to one surface.

export interface SavedView {
  savedViewId: string
  name: string
  surface: string
  config: Record<string, unknown>
  owner: string | null
  updatedAt: string
}

type SavedViewRow = {
  saved_view_id: string
  name: string | null
  surface: string | null
  config: Record<string, unknown> | null
  owner: string | null
  updated_at: Date
}

const VIEW_SELECT = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id AS saved_view_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'view_name')    AS name,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'view_surface') AS surface,
    (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'view_config')           AS config,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'view_owner')   AS owner,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'saved_view'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function mapView(r: SavedViewRow): SavedView {
  return {
    savedViewId: r.saved_view_id,
    name: r.name ?? '',
    surface: r.surface ?? '',
    config: r.config ?? {},
    owner: r.owner,
    updatedAt: r.updated_at.toISOString(),
  }
}

// List saved views, firm-wide. Pass a surface to scope to one list.
export async function listSavedViews(ctx: ActionContext, surface?: string): Promise<SavedView[]> {
  return withActionContext(ctx, async (client) => {
    const where = surface
      ? `${VIEW_SELECT} AND EXISTS (
           SELECT 1 FROM attribute a2 JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id
           WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'view_surface'
             AND a2.value #>> '{}' = $2)`
      : VIEW_SELECT
    const res = await client.query<SavedViewRow>(
      `${where} ORDER BY name`,
      surface ? [ctx.tenantId, surface] : [ctx.tenantId],
    )
    return res.rows.map(mapView)
  })
}

export async function getSavedView(
  ctx: ActionContext,
  savedViewId: string,
): Promise<SavedView | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<SavedViewRow>(`${VIEW_SELECT} AND e.id = $2`, [
      ctx.tenantId,
      savedViewId,
    ])
    return res.rows[0] ? mapView(res.rows[0]) : null
  })
}
