// Apply the substrate seed (supabase/seed/*.sql) to DATABASE_URL.
// CLI-independent: works against any Postgres (remote Supabase project or local)
// without requiring the Supabase CLI. The seed is idempotent (fixed UUIDs +
// ON CONFLICT / NOT EXISTS), so re-running is safe.
//
//   DATABASE_URL=... pnpm seed
//
// Note: `supabase start` / `supabase db reset` already run the seed via
// supabase/config.toml [db.seed]; this script is for seeding a REMOTE project
// after `supabase db push` (which applies migrations but not the seed).
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required (set it in .env.local or the environment).')
    process.exit(1)
  }
  const seedDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'seed')
  const files = readdirSync(seedDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    console.error(`No .sql files found in ${seedDir}`)
    process.exit(1)
  }
  const pool = new pg.Pool({ connectionString: url })
  try {
    for (const file of files) {
      const sql = readFileSync(join(seedDir, file), 'utf8')
      process.stdout.write(`seeding ${file} ... `)
      await pool.query(sql)
      console.log('ok')
    }
    console.log(`Seed complete (${files.length} file(s)).`)
  } finally {
    await pool.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
