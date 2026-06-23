// Apply ONLY a chosen SUBSET of vertical migrations to DATABASE_URL — for when prod
// lags main and you want to ship one self-contained feature's migrations WITHOUT
// sweeping in every other pending migration that `scripts/migrate-vertical.mjs`
// would apply. Same ledger + checksum contract as migrate-vertical.mjs.
//
//   DATABASE_URL=<owner/migration url> node scripts/apply-vertical-subset.mjs [version...]
//   # default set: 0101 0102 0103 0104 0105 0106  (admin console / control plane, ADR 0046)
//
// Each file runs in its OWN transaction (apply + ledger insert): a failure rolls
// that file back fully and stops. Idempotent — an already-applied version is
// skipped; a checksum mismatch on an applied version is a hard error (the file was
// edited after being applied; applied migrations are immutable).
//
// SCOPED APPLY CAVEAT: you are asserting the chosen versions are self-contained
// w.r.t. any LOWER-numbered migrations not yet applied. The script prints exactly
// which other pending migrations it is skipping so you can confirm that's intended.
// (The 0101-0106 control-plane set depends only on core + 0072/0078/0079 + the
// tenant-zero seed — all long-applied on prod — so it is safe to apply alone.)
import pg from 'pg'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations_vertical')
const DEFAULT_VERSIONS = ['0101', '0102', '0103', '0104', '0105', '0106']

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  const requested = (args.length ? args : DEFAULT_VERSIONS).map((v) => v.padStart(4, '0')).sort()

  const byVersion = new Map(
    readdirSync(DIR)
      .filter((f) => f.endsWith('.sql'))
      .map((f) => [f.replace(/_.*$/, '').replace(/\.sql$/, ''), f]),
  )

  // Resolve each requested version to its file (fail loudly on a typo / missing file).
  const files = []
  for (const version of requested) {
    const file = byVersion.get(version)
    if (!file) {
      console.error(`No vertical migration file for version ${version}.`)
      process.exit(1)
    }
    files.push({ version, file })
  }

  const pool = new pg.Pool({ connectionString: url })
  try {
    const has = await pool.query(
      `SELECT to_regclass('private.vertical_migration') IS NOT NULL AS ok`,
    )
    if (!has.rows[0].ok) {
      throw new Error('private.vertical_migration is missing — apply the CORE migrations first.')
    }

    const applied = new Map(
      (await pool.query(`SELECT version, checksum FROM private.vertical_migration`)).rows.map(
        (r) => [r.version, r.checksum],
      ),
    )

    // Transparency: in-repo versions that are neither requested nor applied — i.e.
    // exactly what this scoped run is deliberately leaving for a later full sync.
    const skipping = [...byVersion.keys()]
      .filter((v) => !requested.includes(v) && !applied.has(v))
      .sort()
    if (skipping.length) {
      console.log(
        `subset: NOT applying ${skipping.length} other pending migration(s): ${skipping.join(', ')}`,
      )
    }

    let count = 0
    for (const { version, file } of files) {
      const sql = readFileSync(join(DIR, file), 'utf8').replace(/\r\n/g, '\n')
      const checksum = createHash('sha256').update(sql).digest('hex')
      if (applied.has(version)) {
        if (applied.get(version) && applied.get(version) !== checksum) {
          throw new Error(
            `vertical migration ${file} was modified after being applied (checksum mismatch). Applied migrations are immutable.`,
          )
        }
        console.log(`subset: ${file} already applied — skipped.`)
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
        console.log(`subset: applied ${file}`)
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
    console.log(`subset: ${count} applied, ${files.length - count} already current.`)
  } finally {
    await pool.end()
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
