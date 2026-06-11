// Catch-up sync for the public.schema_migration ledger (invariant 12).
//
// Apply tooling (supabase db push / MCP apply_migration) records a migration's
// row in supabase_migrations.schema_migrations AFTER running its SQL — so the
// final migration's own in-file sync_migration_history() call can never see
// its own row, and the queryable ledger lags by one until the NEXT migration.
// Bit the v1.0.0 clone bootstrap and the v1.0.1 reference rollout (decisions
// log #9). Run this after any core apply; pnpm migrate / migrate:core wire it.
//
//   DATABASE_URL=<owner url> node scripts/sync-migration-ledger.mjs
import pg from 'pg'

const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}
const client = new pg.Client({ connectionString: url })
await client.connect()
try {
  await client.query('SELECT public.sync_migration_history()')
  const res = await client.query(
    `SELECT (SELECT count(*) FROM public.schema_migration WHERE entry_kind = 'migration') AS ledger,
            (SELECT count(*) FROM supabase_migrations.schema_migrations) AS applied`,
  )
  const { ledger, applied } = res.rows[0]
  console.log(`ledger synced: ${ledger} ledger rows / ${applied} applied migrations`)
  if (Number(ledger) !== Number(applied)) {
    console.error('ledger/applied mismatch — investigate before proceeding (invariant 12).')
    process.exit(1)
  }
} finally {
  await client.end()
}
