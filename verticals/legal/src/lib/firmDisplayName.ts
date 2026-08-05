// SECOND-FIRM-1 — the tenant's firm display name for surfaces that have a
// tenantId but no full ActionContext (adapter-level code: the Gmail sender
// header, the executed-copy certificate written inside an action transaction).
//
// Same resolution doctrine as api/tenantSettings.ts, scoped to ONE field:
// the firm_profile singleton's firm_name attribute wins; an EXPLICIT CLEAR
// ('' row) stays cleared (null, no resurrection); only a never-set profile
// falls back to the legacy wedge-era tenant_settings table. Anything else is
// null — callers render product-generic copy ("the firm" / the bare product
// name), NEVER a demo-firm default (the #282-285 doctrine).
import { withTenant, type DbClient } from '@exsto/shared'

// Tri-state: string = set; null = explicit clear ('' row); undefined = no row.
export async function readProfileFirmName(
  client: DbClient,
  tenantId: string,
): Promise<string | null | undefined> {
  const res = await client.query<{ v: string | null }>(
    `SELECT a.value #>> '{}' AS v
       FROM attribute a
       JOIN attribute_kind_definition akd
         ON akd.id = a.attribute_kind_id AND akd.kind_name = 'firm_name'
       JOIN entity e ON e.id = a.entity_id AND e.tenant_id = a.tenant_id
       JOIN entity_kind_definition ekd
         ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'firm_profile'
      WHERE a.tenant_id = $1 AND e.status = 'active'
        AND (a.valid_to IS NULL OR a.valid_to > now())
      ORDER BY a.valid_from DESC
      LIMIT 1`,
    [tenantId],
  )
  if (res.rows.length === 0) return undefined
  const v = res.rows[0]!.v
  return typeof v === 'string' && v.trim() ? v : null // '' row = explicit clear
}

// The resolved firm display name for a tenant, or null when unset/cleared.
// Never throws for a missing legacy table (wedge envs) — degrades to null.
export async function resolveFirmDisplayName(tenantId: string): Promise<string | null> {
  const profile = await withTenant(tenantId, (client) =>
    readProfileFirmName(client, tenantId),
  ).catch((): null => null)
  if (profile !== undefined) return profile
  // Never-set profile → legacy table, in its OWN transaction so a missing
  // tenant_settings table (wedge envs) aborts only this read, not the caller's.
  return withTenant(tenantId, async (client) => {
    const res = await client.query<{ firm_name: string | null }>(
      `SELECT firm_name FROM tenant_settings WHERE tenant_id = $1`,
      [tenantId],
    )
    const v = res.rows[0]?.firm_name
    return typeof v === 'string' && v.trim() ? v : null
  }).catch((): null => null)
}
