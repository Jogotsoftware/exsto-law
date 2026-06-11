// Upgrade a clone to a newer foundation version (ADR 0043). Hands-free:
//
//   1. read the clone's current foundation version (system_capability_registry)
//   2. fetch the `foundation` git remote; read the target version (VERSION at the ref)
//   3. semver-gate: refuse downgrade; no-op if equal; refuse crossing a MAJOR
//      without an acknowledged migration guide (docs/upgrades/<from>-to-<to>.md)
//   4. sync foundation-owned paths at the target ref (NEVER touches verticals/,
//      apps/<vertical>, supabase/migrations_vertical/, .env.local)
//   5. install + build
//   6. apply CORE migrations (supabase db push) then VERTICAL migrations
//   7. run the invariant suite — abort (no stamp) if it fails
//   8. record the upgrade: a governed config.change action + a configuration_change
//      row + bump the stamp (with history)
//
// Atomicity: each migration applies in its own transaction (a broken one rolls back
// fully — nothing half-applied — and the run aborts before stamping). See the
// `exsto-upgrade-foundation` skill for the failure/recovery procedure.
//
//   DATABASE_URL=<owner url> node scripts/upgrade-foundation.mjs \
//     [--to <ref>] [--foundation <git-url>] [--force-major]
import pg from 'pg'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TENANT_ZERO = '00000000-0000-0000-0000-000000000001'
const SYSTEM_ACTOR = '00000000-0000-0000-0001-000000000001'

// Foundation-owned paths synced on upgrade. Clone-owned paths (verticals/, the
// vertical app, supabase/migrations_vertical/, .env.local) are deliberately absent.
const FOUNDATION_PATHS = [
  'VERSION',
  'supabase/migrations',
  'packages/shared',
  'packages/substrate',
  'packages/primitives',
  'packages/mcp-tools',
  'apps/mcp-server',
  'apps/rest-api',
  'scripts',
  'adr',
  'docs/upgrades',
  'CLAUDE.md',
  'ARCHITECTURE.md',
  '.claude/skills',
]

function arg(flag, def) {
  const i = process.argv.indexOf(flag)
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const hasFlag = (f) => process.argv.includes(f)
// execSync returns null when stdio is 'inherit' (output is not captured), so guard
// the .toString() — otherwise inherited-output steps (install/build/push) crash.
const sh = (cmd, opts = {}) => {
  const out = execSync(cmd, { cwd: ROOT, stdio: 'pipe', ...opts })
  return out ? out.toString().trim() : ''
}
const log = (m) => console.log(`[upgrade] ${m}`)

function parseSemver(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
  if (!m) throw new Error(`not a semver version: ${v}`)
  return { major: +m[1], minor: +m[2], patch: +m[3], raw: v.trim() }
}
function cmpSemver(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

async function readCurrentVersion(url) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    const { rows } = await client.query(
      `SELECT snapshot->'foundation'->>'version' AS version
       FROM system_capability_registry WHERE tenant_id = $1`,
      [TENANT_ZERO],
    )
    return rows[0]?.version ?? null
  } finally {
    await client.end()
  }
}

async function syncMigrationHistory(url) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query('SELECT public.sync_migration_history()')
  } finally {
    await client.end()
  }
}

async function recordUpgrade(url, fromV, toV, commit) {
  // Governed action via the (built) action layer, then the configuration_change +
  // stamp bump as deployment infra (the hard rules permit direct DB access here).
  const { submitAction } = await import(pathToUrl(join(ROOT, 'packages/substrate/dist/index.js')))
  await import(pathToUrl(join(ROOT, 'packages/primitives/dist/index.js'))) // register handlers
  // Since v1.0.1 the config.change HANDLER inserts the configuration_change row
  // itself — the payload must speak its contract (target_table/change_kind/
  // before/after/reason). The script's old direct INSERT is gone: it would
  // duplicate the row, and the old payload shape left the handler's NOT NULL
  // target_table unset (found by the first real-world upgrade drill — the
  // pre-v1.0.1 silent no-op had been masking the mismatch).
  const res = await submitAction(
    { tenantId: TENANT_ZERO, actorId: SYSTEM_ACTOR },
    {
      actionKindName: 'config.change',
      intentKind: 'automatic_sync',
      payload: {
        target_table: 'system_capability_registry',
        change_kind: 'update',
        before_value: { version: fromV },
        after_value: { version: toV, commit },
        change_reason: 'foundation upgrade',
      },
    },
  )
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    await client.query(
      `UPDATE system_capability_registry SET
         snapshot = jsonb_set(snapshot, '{foundation}', jsonb_build_object(
           'version', $2::text, 'commit', $3::text, 'stamped_at', now()::text,
           'history', COALESCE(snapshot->'foundation'->'history','[]'::jsonb) ||
                      jsonb_build_object('from', $4::text, 'to', $2::text, 'at', now()::text, 'commit', $3::text))),
         computed_at = now(), recorded_at = now()
       WHERE tenant_id = $1`,
      [TENANT_ZERO, toV, commit, fromV],
    )
  } finally {
    await client.end()
  }
  return res.actionId
}

function pathToUrl(p) {
  return 'file:///' + p.replace(/\\/g, '/')
}

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required.')
  const ref = arg('--to', 'foundation/main')
  const foundationUrl = arg('--foundation', process.env.FOUNDATION_REMOTE)

  // 1. current version
  const currentRaw = await readCurrentVersion(url)
  if (!currentRaw) throw new Error('No foundation stamp found — is this a stamped clone?')
  const current = parseSemver(currentRaw)
  log(`current foundation version: ${current.raw}`)

  // 2. foundation remote + target version
  const remotes = sh('git remote')
  if (!remotes.split('\n').includes('foundation')) {
    if (!foundationUrl) throw new Error('No `foundation` remote and no --foundation <url> given.')
    sh(`git remote add foundation ${foundationUrl}`)
    log(`added foundation remote: ${foundationUrl}`)
  }
  const fetchRef = ref.replace(/^foundation\//, '')
  sh(`git fetch foundation ${fetchRef} --tags`)
  // Tags fetch into the plain tag namespace (refs/tags/<name>), not under the
  // remote prefix — resolve `--to foundation/v1.x.y` to the tag when the
  // remote-prefixed ref doesn't exist (v1.0.1 upgrade drill finding).
  let showRef = ref
  try {
    sh(`git rev-parse --verify --quiet "${showRef}^{commit}"`)
  } catch {
    showRef = fetchRef
  }
  const targetRaw = sh(`git show ${showRef}:VERSION`)
  const target = parseSemver(targetRaw)
  log(`target foundation version: ${target.raw} (${showRef})`)

  // 3. semver gate
  const c = cmpSemver(target, current)
  if (c === 0) {
    log('already at the target version — nothing to do.')
    return
  }
  if (c < 0) throw new Error(`refusing downgrade: target ${target.raw} < current ${current.raw}`)
  if (target.major > current.major && !hasFlag('--force-major')) {
    const guide = `docs/upgrades/${current.raw}-to-${target.raw}.md`
    if (!existsSync(join(ROOT, guide))) {
      throw new Error(
        `MAJOR upgrade ${current.raw} -> ${target.raw} requires a migration guide (${guide}) or --force-major.`,
      )
    }
  }

  // 4. sync foundation-owned paths (clone-owned paths untouched)
  log(`syncing foundation paths from ${showRef} …`)
  sh(`git checkout ${showRef} -- ${FOUNDATION_PATHS.join(' ')}`)

  // 5. install + build
  log('installing + building …')
  sh('corepack pnpm install', { stdio: 'inherit' })
  sh('corepack pnpm build', { stdio: 'inherit' })

  // 6. apply CORE then VERTICAL migrations
  log('applying core migrations (supabase db push) …')
  // --db-url: the script already requires DATABASE_URL; a bare `db push` needs a
  // linked project + CLI auth, which a freshly cloned platform may not have
  // (v1.0.1 upgrade drill finding — the upgrade must be hands-free).
  sh(`npx -y supabase@2 db push --db-url "${url}"`, { stdio: 'inherit' })
  // db push records each migration in the CLI ledger AFTER running its SQL, so the
  // final migration's own sync_migration_history() runs before that record exists —
  // public.schema_migration would miss it (invariant 12). Run the catch-up sync, the
  // same reconciliation supabase/seed/0002 does for the db-reset path.
  await syncMigrationHistory(url)
  log('applying vertical migrations …')
  sh('node scripts/migrate-vertical.mjs', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  })

  // 7. verify — abort before stamping if the suite fails
  log('running invariant suite against the upgraded clone …')
  sh('corepack pnpm exec vitest run tests/invariants', {
    stdio: 'inherit',
    env: { ...process.env, SUBSTRATE_TEST_DATABASE_URL: url },
  })

  // 8. record the upgrade ("^" must be quoted: it is cmd.exe's escape char)
  const commit = sh(`git rev-parse "${showRef}^{commit}"`)
  await recordUpgrade(url, current.raw, target.raw, commit)
  log(
    `UPGRADE OK: ${current.raw} -> ${target.raw} (commit ${commit.slice(0, 8)}), recorded as a configuration_change.`,
  )
}

main().catch((e) => {
  console.error(`[upgrade] FAILED: ${String(e.message ?? e)}`)
  console.error(
    '[upgrade] The clone was NOT stamped. See the exsto-upgrade-foundation skill for recovery.',
  )
  process.exit(1)
})
