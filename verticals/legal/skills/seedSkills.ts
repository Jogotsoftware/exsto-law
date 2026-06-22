// Seed the firm's assistant skills (legal playbooks ported from claude-for-legal)
// into the substrate THROUGH THE ACTION LAYER. Each skill is a markdown file with
// frontmatter under verticals/legal/skills/<area>/<slug>.md; this reads them all
// and upserts (create-or-update by slug) so the seed is idempotent — re-running
// refreshes bodies without duplicating entities (the substrate is append-only;
// upsert supersedes attributes, it never deletes).
//
//   pnpm seed:skills      (tsx --env-file=.env.local)
//
// Requires DATABASE_URL (.env.local) and a built @exsto/legal (pnpm --filter
// @exsto/legal build), exactly like the demo seed.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, relative } from 'node:path'

import { closeDbPool, withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { upsertSkill, type UpsertSkillInput } from '@exsto/legal'

const here = dirname(fileURLToPath(import.meta.url))

// Every active tenant gets the skills (not just tenant zero). Each is seeded
// through the action layer under its own system actor.
interface SeedTarget {
  tenantId: string
  name: string
  actorId: string
  hasSkillKind: boolean
}

// Resolve every active tenant + its system actor + whether the skill kind has
// been provisioned for it (migration 0083 backfills the kind to all tenants).
// Superuser read — this crosses tenants, so RLS must be bypassed deliberately.
async function resolveTargets(): Promise<SeedTarget[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<{
      tenant_id: string
      name: string
      actor_id: string | null
      has_skill_kind: boolean
    }>(
      `SELECT t.id AS tenant_id, t.name,
              (SELECT a.id FROM actor a
                 WHERE a.tenant_id = t.id AND a.actor_type = 'system'
                 ORDER BY a.created_at LIMIT 1) AS actor_id,
              EXISTS (SELECT 1 FROM entity_kind_definition e
                        WHERE e.tenant_id = t.id AND e.kind_name = 'skill' AND e.status = 'active')
                AS has_skill_kind
         FROM tenant t
        WHERE t.status = 'active'
        ORDER BY t.id`,
    )
    return res.rows.map((r) => ({
      tenantId: r.tenant_id,
      name: r.name,
      actorId: r.actor_id ?? '',
      hasSkillKind: r.has_skill_kind,
    }))
  })
}

// Recursively collect every .md file under the skills directory (skipping this
// script's own dir markers). Skill content only — frontmatter + body.
function findMarkdown(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name)
    if (statSync(full).isDirectory()) out.push(...findMarkdown(full))
    else if (name.endsWith('.md') && name !== 'README.md') out.push(full)
  }
  return out
}

// Minimal frontmatter parser: a leading `---` block of single-line `key: value`
// pairs, then the markdown body. No YAML dep — we control the format, so keys are
// single-line (slug, name, practice_area, description, when_to_use, user_invocable).
function parseSkillFile(text: string, file: string): UpsertSkillInput {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!m) throw new Error(`${file}: missing frontmatter block.`)
  const [, fm, body] = m
  const fields: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const need = (k: string): string => {
    const v = fields[k]
    if (!v) throw new Error(`${file}: frontmatter missing "${k}".`)
    return v
  }
  return {
    slug: need('slug'),
    name: need('name'),
    practiceArea: need('practice_area'),
    description: fields.description ?? '',
    whenToUse: need('when_to_use'),
    body: body.trim(),
    userInvocable: (fields.user_invocable ?? 'true').toLowerCase() !== 'false',
  }
}

// Parse every skill file once (deduped by slug) into upsert inputs.
function parseAllSkills(): UpsertSkillInput[] {
  const out: UpsertSkillInput[] = []
  const seen = new Set<string>()
  for (const file of findMarkdown(here).sort()) {
    const rel = relative(here, file)
    let input: UpsertSkillInput
    try {
      input = parseSkillFile(readFileSync(file, 'utf8'), rel)
    } catch (err) {
      console.error(`  ✗ ${rel}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (seen.has(input.slug)) {
      console.error(`  ✗ ${rel}: duplicate slug "${input.slug}" — skipped.`)
      continue
    }
    seen.add(input.slug)
    out.push(input)
  }
  return out
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (set it in .env.local).')
  }
  const skills = parseAllSkills()
  if (!skills.length) {
    console.log('No skill markdown files found under verticals/legal/skills/.')
    return
  }

  const targets = await resolveTargets()
  console.log(`▸ Seeding ${skills.length} skill(s) into ${targets.length} active tenant(s)…`)

  let seededTenants = 0
  for (const t of targets) {
    if (!t.hasSkillKind) {
      console.warn(
        `  ⚠ ${t.name} (${t.tenantId}): skill kind not provisioned — run \`pnpm migrate:vertical\` first. Skipped.`,
      )
      continue
    }
    if (!t.actorId) {
      console.warn(`  ⚠ ${t.name} (${t.tenantId}): no system actor found. Skipped.`)
      continue
    }
    const ctx: ActionContext = { tenantId: t.tenantId, actorId: t.actorId }
    let ok = 0
    for (const input of skills) {
      try {
        await upsertSkill(ctx, input)
        ok++
      } catch (err) {
        console.error(`  ✗ [${t.name}] ${input.slug}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    seededTenants++
    console.log(`  ✓ ${t.name}: ${ok}/${skills.length} skill(s)`)
  }
  console.log(`✓ Seeded ${skills.length} skill(s) across ${seededTenants} tenant(s).`)
}

main()
  .then(() => closeDbPool())
  .catch(async (err) => {
    console.error(err)
    await closeDbPool()
    process.exit(1)
  })
