// One-off activation seeder: upsert ONLY the 5 firm-admin build-wizard skills.
// Surgical on purpose — the full seed:skills re-writes every skill, and we will not
// risk the live 104. This reads only verticals/legal/skills/firm-admin/*.md and
// upserts them by slug through the action layer (idempotent). Run with the prod
// DATABASE_URL: tsx --env-file=<main-worktree>/.env.local this-file.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { upsertSkill, type UpsertSkillInput } from '@exsto/legal'
import { type ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004' // seeded Claude agent actor

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../skills/firm-admin')

function parse(text: string, file: string): UpsertSkillInput {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) throw new Error(`${file}: missing frontmatter`)
  const fields: Record<string, string> = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  const need = (k: string): string => {
    const v = fields[k]
    if (!v) throw new Error(`${file}: frontmatter missing "${k}"`)
    return v
  }
  return {
    slug: need('slug'),
    name: need('name'),
    practiceArea: need('practice_area'),
    description: fields.description ?? '',
    whenToUse: need('when_to_use'),
    body: m[2].trim(),
    userInvocable: (fields.user_invocable ?? 'true').toLowerCase() !== 'false',
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
  const files = readdirSync(DIR).filter((f) => f.endsWith('.md'))
  console.log(`Seeding ${files.length} firm-admin skills…`)
  for (const f of files) {
    const input = parse(readFileSync(join(DIR, f), 'utf8'), f)
    await upsertSkill(ctx, input)
    console.log(`  ✓ ${input.slug} (user_invocable=${input.userInvocable})`)
  }
  console.log('Done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
