// Logical backup + restore proof (Task 3d / docs/RECOVERY.md).
//
// Supabase's native backups for exsto-dev are WAL-G daily PHYSICAL backups, and
// the native restore is IN-PLACE (it overwrites the source project). To prove
// recoverability WITHOUT touching exsto-dev, this does a logical backup/restore:
//
//   1. BACKUP  — read every public table from SOURCE_URL (read-only) and write a
//                single JSON artifact to disk (the "backup").
//   2. RESTORE — load that artifact into TARGET_URL, whose schema was established
//                by replaying the migrations. Type round-tripping is done
//                server-side (row_to_json on read, json_populate_record on write),
//                so every column type is reconstructed exactly. A fixpoint insert
//                loop satisfies FK ordering (incl. self-references) without
//                superuser/replica mode.
//
//   SOURCE_URL=<exsto-dev> node scripts/logical-backup-restore.mjs backup  out.json
//   TARGET_URL=<recovery>  node scripts/logical-backup-restore.mjs restore out.json
import pg from 'pg'
import { readFileSync, writeFileSync } from 'node:fs'

const mode = process.argv[2]
const file = process.argv[3]
if (!['backup', 'restore'].includes(mode) || !file) {
  console.error('usage: <backup|restore> <artifact.json>')
  process.exit(1)
}

async function listPublicTables(client) {
  const { rows } = await client.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  )
  return rows.map((r) => r.tablename)
}

async function backup() {
  const url = process.env.SOURCE_URL
  if (!url) throw new Error('SOURCE_URL required for backup.')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const tables = await listPublicTables(client)
    const artifact = { takenAtNote: 'logical backup', tables: {} }
    let total = 0
    for (const t of tables) {
      // row_to_json serializes every column with its own type; we store text.
      const { rows } = await client.query(`SELECT row_to_json(x) AS j FROM public.${ident(t)} x`)
      artifact.tables[t] = rows.map((r) => r.j)
      total += rows.length
    }
    writeFileSync(file, JSON.stringify(artifact))
    console.log(`BACKUP ok: ${tables.length} tables, ${total} rows -> ${file}`)
  } finally {
    await client.end()
  }
}

function ident(name) {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`unsafe identifier: ${name}`)
  return name
}

async function restore() {
  const url = process.env.TARGET_URL
  if (!url) throw new Error('TARGET_URL required for restore.')
  const artifact = JSON.parse(readFileSync(file, 'utf8'))
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    // Flatten to a work list of (table, jsonRow). Skip schema_migration — it is the
    // target's OWN migration ledger (managed by the migrate step + sync), not
    // restorable substrate data; restoring the source's rows would double-count it.
    const SKIP = new Set(['schema_migration'])
    const work = []
    for (const [t, rows] of Object.entries(artifact.tables)) {
      if (SKIP.has(t)) continue
      for (const j of rows) work.push({ t, j })
    }
    let remaining = work
    let pass = 0
    let insertedTotal = 0
    while (remaining.length) {
      pass++
      const stillFailing = []
      let insertedThisPass = 0
      for (const item of remaining) {
        try {
          await client.query(
            `INSERT INTO public.${ident(item.t)}
             SELECT * FROM json_populate_record(null::public.${ident(item.t)}, $1::json)
             ON CONFLICT DO NOTHING`,
            [JSON.stringify(item.j)],
          )
          insertedThisPass++
          insertedTotal++
        } catch {
          stillFailing.push(item)
        }
      }
      console.log(`  pass ${pass}: inserted ${insertedThisPass}, ${stillFailing.length} deferred`)
      if (insertedThisPass === 0) {
        remaining = stillFailing
        break
      }
      remaining = stillFailing
    }
    if (remaining.length) {
      // Report the genuine failures with their error.
      const sample = remaining[0]
      try {
        await client.query(
          `INSERT INTO public.${ident(sample.t)}
           SELECT * FROM json_populate_record(null::public.${ident(sample.t)}, $1::json)`,
          [JSON.stringify(sample.j)],
        )
      } catch (e) {
        console.error(`RESTORE residual failure on ${sample.t}: ${e.message.split('\n')[0]}`)
      }
      console.log(`RESTORE incomplete: ${remaining.length} rows could not be inserted.`)
      process.exit(1)
    }
    console.log(`RESTORE ok: ${insertedTotal} rows inserted across ${pass} pass(es).`)
  } finally {
    await client.end()
  }
}

;(mode === 'backup' ? backup() : restore()).catch((e) => {
  console.error(e)
  process.exit(1)
})
