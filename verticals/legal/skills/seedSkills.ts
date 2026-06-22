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

import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { upsertSkill, type UpsertSkillInput } from '@exsto/legal'

const TENANT_ID = '00000000-0000-0000-0000-000000000001'
const ATTORNEY_ACTOR_ID = '00000000-0000-0000-0001-000000000002'
const attorneyCtx: ActionContext = { tenantId: TENANT_ID, actorId: ATTORNEY_ACTOR_ID }

const here = dirname(fileURLToPath(import.meta.url))

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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required (set it in .env.local).')
  }
  const files = findMarkdown(here)
  if (!files.length) {
    console.log('No skill markdown files found under verticals/legal/skills/.')
    return
  }
  console.log(`▸ Seeding ${files.length} skill(s) into tenant ${TENANT_ID}…`)
  let ok = 0
  const bySlug = new Set<string>()
  for (const file of files.sort()) {
    const rel = relative(here, file)
    let input: UpsertSkillInput
    try {
      input = parseSkillFile(readFileSync(file, 'utf8'), rel)
    } catch (err) {
      console.error(`  ✗ ${rel}: ${err instanceof Error ? err.message : String(err)}`)
      continue
    }
    if (bySlug.has(input.slug)) {
      console.error(`  ✗ ${rel}: duplicate slug "${input.slug}" — skipped.`)
      continue
    }
    bySlug.add(input.slug)
    try {
      await upsertSkill(attorneyCtx, input)
      ok++
      console.log(`  ✓ ${input.slug}  (${input.practiceArea})`)
    } catch (err) {
      console.error(`  ✗ ${input.slug}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  console.log(`✓ Seeded ${ok}/${files.length} skill(s).`)
}

main()
  .then(() => closeDbPool())
  .catch(async (err) => {
    console.error(err)
    await closeDbPool()
    process.exit(1)
  })
