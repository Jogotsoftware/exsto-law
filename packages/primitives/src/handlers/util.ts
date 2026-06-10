import type { DbClient } from '@exsto/shared'

// Resolve the active definition id for a kind name in any registry table.
export async function lookupKind(
  client: DbClient,
  table: string,
  tenantId: string,
  kindName: string,
): Promise<string> {
  const r = await client.query<{ id: string }>(
    `SELECT id FROM ${table}
      WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active'
      ORDER BY valid_from DESC LIMIT 1`,
    [tenantId, kindName],
  )
  if (!r.rows[0]) throw new Error(`Kind not found in ${table}: ${kindName}`)
  return r.rows[0].id
}
