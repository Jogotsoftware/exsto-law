// Stamp the foundation version into system_capability_registry (tenant zero), so a
// clone always knows which foundation version + commit it is on (ADR 0043). Run at
// bootstrap (newplatform wires this) and idempotently any time. The version is read
// from the VERSION file; the commit from git (overridable via FOUNDATION_COMMIT).
//
//   DATABASE_URL=<owner url> node scripts/stamp-version.mjs
//
// Upgrades do NOT use this (they record a configuration_change too — see
// scripts/upgrade-foundation.mjs); this is the create-time stamp.
import pg from 'pg'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TENANT_ZERO = '00000000-0000-0000-0000-000000000001'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function foundationVersion() {
  return readFileSync(join(ROOT, 'VERSION'), 'utf8').trim()
}
function foundationCommit() {
  if (process.env.FOUNDATION_COMMIT) return process.env.FOUNDATION_COMMIT
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim()
  } catch {
    return 'unknown'
  }
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error('DATABASE_URL is required.')
    process.exit(1)
  }
  const version = foundationVersion()
  const commit = foundationCommit()
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    // Upsert the single per-tenant capability row, writing the foundation stamp into
    // its snapshot. Preserve any existing upgrade history.
    await client.query(
      `INSERT INTO system_capability_registry (tenant_id, snapshot, computed_at)
       VALUES ($1, jsonb_build_object('foundation', jsonb_build_object(
                 'version', $2::text, 'commit', $3::text,
                 'stamped_at', now()::text, 'history', '[]'::jsonb)), now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         snapshot = system_capability_registry.snapshot || jsonb_build_object('foundation',
                      jsonb_build_object('version', $2::text, 'commit', $3::text,
                        'stamped_at', now()::text,
                        'history', COALESCE(system_capability_registry.snapshot->'foundation'->'history', '[]'::jsonb))),
         computed_at = now(), recorded_at = now()`,
      [TENANT_ZERO, version, commit],
    )
    console.log(
      `stamped foundation version ${version} (commit ${commit.slice(0, 8)}) for tenant zero.`,
    )
  } finally {
    await client.end()
  }
}

main().catch((e) => {
  console.error(String(e.message ?? e))
  process.exit(1)
})
