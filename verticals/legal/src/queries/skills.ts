import { withActionContext, type ActionContext } from '@exsto/substrate'

// Skills read layer. A skill is a `skill` entity — a reusable instruction asset
// the assistant loads on demand (ported from claude-for-legal). Two reads:
//   listSkillCatalog() — lightweight {slug, name, practice_area, when_to_use,
//     description}, always injected into the assistant system prompt so the model
//     knows what's available (the routing surface).
//   getSkillBySlug()   — the full body, fetched only when a skill is triggered
//     (progressive disclosure — the long markdown never sits in context idle).

export interface SkillCatalogEntry {
  slug: string
  name: string
  practiceArea: string
  description: string
  whenToUse: string
  userInvocable: boolean
}

export interface Skill extends SkillCatalogEntry {
  skillEntityId: string
  body: string
  updatedAt: string
}

type SkillRow = {
  skill_entity_id: string
  slug: string | null
  name: string | null
  practice_area: string | null
  description: string | null
  when_to_use: string | null
  body: string | null
  user_invocable: boolean | null
  updated_at: Date
}

// Latest value per (entity, attribute kind). Mirrors the standalone-template read
// (queries/templates.ts). `$body` is spliced in only for the full single-skill
// read so the catalog never pulls the long bodies into memory.
function skillSelect(includeBody: boolean): string {
  return `
  SELECT
    e.id AS skill_entity_id,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_slug' ORDER BY a.valid_from DESC LIMIT 1)          AS slug,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_name' ORDER BY a.valid_from DESC LIMIT 1)          AS name,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_practice_area' ORDER BY a.valid_from DESC LIMIT 1) AS practice_area,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_description' ORDER BY a.valid_from DESC LIMIT 1)   AS description,
    (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_when_to_use' ORDER BY a.valid_from DESC LIMIT 1)   AS when_to_use,
    (SELECT (a.value #>> '{}')::boolean FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_user_invocable' ORDER BY a.valid_from DESC LIMIT 1) AS user_invocable,
    ${includeBody ? `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'skill_body' ORDER BY a.valid_from DESC LIMIT 1)` : 'NULL'} AS body,
    e.created_at AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'skill'
  WHERE e.tenant_id = $1 AND e.status = 'active'`
}

function mapCatalog(r: SkillRow): SkillCatalogEntry {
  return {
    slug: r.slug ?? '',
    name: r.name ?? '',
    practiceArea: r.practice_area ?? '',
    description: r.description ?? '',
    whenToUse: r.when_to_use ?? '',
    userInvocable: r.user_invocable !== false,
  }
}

// Practice areas NOT surfaced to the firm assistant — academic law-school study
// aids (bar prep, flashcards, …). The firm is a law practice, not a law school,
// so these are kept as data but excluded from the catalog and the /skills picker.
// (Still loadable by slug if something references one directly.)
const NON_FIRM_AREAS = new Set(['law-student'])

// Lightweight catalog (no body) — the routing surface for the system prompt and
// the /skills picker. Excludes the non-firm (academic) practice areas.
export async function listSkillCatalog(ctx: ActionContext): Promise<SkillCatalogEntry[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<SkillRow>(`${skillSelect(false)} ORDER BY practice_area, name`, [
      ctx.tenantId,
    ])
    return res.rows.map(mapCatalog).filter((s) => !NON_FIRM_AREAS.has(s.practiceArea))
  })
}

// Full skill incl. body, by stable slug — the load_skill fetch.
export async function getSkillBySlug(ctx: ActionContext, slug: string): Promise<Skill | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<SkillRow>(
      `${skillSelect(true)} AND (
        SELECT a2.value #>> '{}' FROM attribute a2
        JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id
        WHERE a2.tenant_id = $1 AND a2.entity_id = e.id AND akd2.kind_name = 'skill_slug'
        ORDER BY a2.valid_from DESC LIMIT 1
      ) = $2`,
      [ctx.tenantId, slug],
    )
    const r = res.rows[0]
    if (!r) return null
    return {
      ...mapCatalog(r),
      skillEntityId: r.skill_entity_id,
      body: r.body ?? '',
      updatedAt: r.updated_at.toISOString(),
    }
  })
}
