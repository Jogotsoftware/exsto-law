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
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  )
  SELECT
    e.id AS skill_entity_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_slug')          AS slug,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_name')          AS name,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_practice_area') AS practice_area,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_description')   AS description,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_when_to_use')   AS when_to_use,
    (SELECT (value #>> '{}')::boolean FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_user_invocable') AS user_invocable,
    ${includeBody ? `(SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'skill_body')` : 'NULL'} AS body,
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
      `${skillSelect(true)} AND e.id = (
        SELECT entity_id FROM attrs WHERE kind_name = 'skill_slug' AND value #>> '{}' = $2 LIMIT 1
      )`,
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
