// Applies the VERTICAL migration sequence (supabase/migrations_vertical/*.sql),
// recording each in private.vertical_migration. The CORE sequence
// (supabase/migrations/) is applied first by `supabase db push` / `supabase start`;
// this runs after it (see ADR 0043, the core-then-vertical order).
//
// Verticals author their schema here, NEVER in supabase/migrations/, so a
// foundation upgrade's new core migrations never collide with a clone's migrations.
//
//   DATABASE_URL=<owner/migration url> node scripts/migrate-vertical.mjs
//
// Idempotent: already-applied files are skipped. Each file runs in its own
// transaction — a failure rolls that file back fully (nothing half-applied) and
// stops, leaving earlier files applied + recorded.
import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations_vertical')

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  if (!existsSync(DIR)) {
    console.log('vertical: no supabase/migrations_vertical/ directory — nothing to apply.')
    return
  }
  const files = readdirSync(DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
  if (files.length === 0) {
    console.log('vertical: 0 migrations to apply.')
    return
  }

  const pool = new pg.Pool({ connectionString: url })
  try {
    // The ledger table ships in core migration 0026; if the core sequence has not
    // been applied yet, fail loudly rather than silently skip.
    const has = await pool.query(
      `SELECT to_regclass('private.vertical_migration') IS NOT NULL AS ok`,
    )
    if (!has.rows[0].ok) {
      throw new Error(
        'private.vertical_migration is missing — apply the CORE migrations first (supabase db push).',
      )
    }

    const applied = new Map(
      (await pool.query(`SELECT version, checksum FROM private.vertical_migration`)).rows.map(
        (r) => [r.version, r.checksum],
      ),
    )

    let count = 0
    for (const file of files) {
      const version = file.replace(/_.*$/, '').replace(/\.sql$/, '')
      // Normalize line endings before hashing AND applying: on Windows, git's
      // autocrlf re-materializes files with CRLF, which silently changed the
      // checksum of already-applied migrations (first real-world upgrade drill,
      // exsto-law -> v1.0.1). Ledger checksums are LF-based.
      const sql = readFileSync(join(DIR, file), 'utf8').replace(/\r\n/g, '\n')
      const checksum = createHash('sha256').update(sql).digest('hex')

      if (applied.has(version)) {
        if (applied.get(version) && applied.get(version) !== checksum) {
          throw new Error(
            `vertical migration ${file} was modified after being applied (checksum mismatch). Applied migrations are immutable.`,
          )
        }
        continue
      }

      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          `INSERT INTO private.vertical_migration (version, name, checksum) VALUES ($1, $2, $3)`,
          [version, file, checksum],
        )
        await client.query('COMMIT')
        console.log(`vertical: applied ${file}`)
        count++
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw new Error(
          `vertical migration ${file} failed (rolled back): ${e.message.split('\n')[0]}`,
        )
      } finally {
        client.release()
      }
    }
    console.log(`vertical: ${count} applied, ${files.length - count} already current.`)

    // Tenant vocabulary reconcile (0173). Feature migrations seed new kinds and
    // notification routes into TENANT ZERO by convention; the bootstrap copy runs
    // only at tenant creation, so tenants created earlier drift. Running the sync
    // after every migration pass means "seed tenant zero" reaches EVERY tenant in
    // the same `pnpm migrate:vertical`. Guarded: a database that predates 0173
    // (or a core-only database) simply skips.
    const syncFn = await pool.query(
      `SELECT to_regproc('private.cp_sync_all_tenant_vocab') IS NOT NULL AS ok`,
    )
    if (syncFn.rows[0].ok) {
      const res = await pool.query(`SELECT private.cp_sync_all_tenant_vocab() AS summary`)
      const summary = res.rows[0].summary
      console.log(
        Object.keys(summary).length === 0
          ? 'vertical: tenant vocab in sync (nothing to copy).'
          : `vertical: tenant vocab synced — ${JSON.stringify(summary)}`,
      )
    }
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
