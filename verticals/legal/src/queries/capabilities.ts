import { withActionContext, type ActionContext } from '@exsto/substrate'

// Read side of the platform capability library. The service-builder reads this
// catalog to decide reuse vs. build. Mirrors queries/skills.ts (entity +
// superseded attributes → one row per capability, latest values).

export interface CapabilitySpec {
  name: string
  category?: string
  purpose?: string
  when_to_use?: string
  backed_by?: string[]
  docs_path?: string
}

export interface Capability {
  capabilityEntityId: string
  slug: string
  status: string
  spec: CapabilitySpec
}

function parseSpec(raw: unknown): CapabilitySpec {
  if (raw && typeof raw === 'object') return raw as CapabilitySpec
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as CapabilitySpec
    } catch {
      return { name: 'Unknown capability' }
    }
  }
  return { name: 'Unknown capability' }
}

// Every active capability, newest attribute values, ordered by slug. `status`
// filters when provided (e.g. 'available' for what the builder can wire today).
export async function listCapabilities(
  ctx: ActionContext,
  opts?: { status?: string },
): Promise<Capability[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      entity_id: string
      slug: string | null
      status: string | null
      spec: unknown
    }>(
      `WITH attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE a.tenant_id = $1 AND ekd.kind_name = 'platform_capability' AND e.status = 'active'
         ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       )
       SELECT e.id AS entity_id,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'capability_slug')   AS slug,
         (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'capability_status') AS status,
         (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'capability_spec')            AS spec
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'platform_capability'
       WHERE e.tenant_id = $1 AND e.status = 'active'`,
      [ctx.tenantId],
    )
    return res.rows
      .filter((r) => r.slug)
      .map((r) => ({
        capabilityEntityId: r.entity_id,
        slug: r.slug as string,
        status: r.status ?? 'available',
        spec: parseSpec(r.spec),
      }))
      .filter((c) => !opts?.status || c.status === opts.status)
      .sort((a, b) => a.slug.localeCompare(b.slug))
  })
}
