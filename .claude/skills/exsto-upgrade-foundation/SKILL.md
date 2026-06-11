---
name: exsto-upgrade-foundation
description: Upgrade an existing Exsto clone to a newer foundation version WITHOUT clobbering its Layer-3 vertical — pull new core migrations + substrate code, apply, verify with the invariant suite, and record the upgrade. ALWAYS use this when a clone needs foundation fixes/features, when "update the substrate", "pull the latest foundation", "bump the foundation version", or after the foundation ships a new release. Trigger on "/exsto-upgrade-foundation", "upgrade the foundation", "update this clone".
---

# Upgrading a clone to a new foundation version

A clone is a fork that grew a Layer-3 vertical; the foundation keeps shipping core
migrations, substrate code, and fixes. This is the **one safe path** to take those
updates (ADR 0043). It is mechanical and hands-free — do not hand-merge foundation
changes, and never edit foundation-owned paths in a clone (the upgrade overwrites
them).

**Key principle — two namespaces keep your vertical safe.** Core migrations live in
`supabase/migrations/` (foundation-owned); your vertical migrations live in
`supabase/migrations_vertical/` (yours). The upgrade only touches foundation-owned
paths, so your vertical schema, code, and data are never touched.

## Prerequisite

The clone has a `foundation` git remote (the canonical repo) and a foundation
**stamp** in `system_capability_registry` (every clone created by `newplatform` is
stamped). `DATABASE_URL` points at the clone's database (owner/migration role).

## Run it

One command does everything:

```bash
DATABASE_URL=<clone owner url> pnpm upgrade            # to foundation/main
# or a specific release (tag refs resolve via the fetched tag namespace):
DATABASE_URL=… node scripts/upgrade-foundation.mjs --to v1.0.2
# first time (no remote yet):
DATABASE_URL=… node scripts/upgrade-foundation.mjs --foundation https://github.com/Jogotsoftware/exsto.git
```

`scripts/upgrade-foundation.mjs` performs, in order:

1. Reads the clone's current foundation version from the stamp.
2. Fetches `foundation`, reads the target version (`VERSION` at the ref).
3. **Semver gate:** refuses a downgrade; no-ops if already current; refuses to
   cross a **major** boundary unless `docs/upgrades/<from>-to-<to>.md` exists (or
   `--force-major`) — breaking changes need a written guide.
4. **Syncs foundation-owned paths** at the target ref (migrations, substrate
   packages, adapters, skills, ADRs, the invariant test suite, VERSION). It NEVER
   touches `verticals/`, your vertical app, `supabase/migrations_vertical/`,
   `vitest.config.ts`, or `.env.local`. It then **re-executes itself** so the rest
   of the run uses the target version's own tooling.
5. `pnpm install && pnpm build`.
6. Applies **core** migrations (`supabase db push`) then **vertical** migrations
   (`scripts/migrate-vertical.mjs`).
7. Runs the **invariant suite** against the upgraded clone. If it fails, the run
   **aborts before stamping** — the upgrade is verified, not assumed.
8. Records the upgrade: a governed `config.change` action + a `configuration_change`
   row + bumps the stamp (with history).

## Verify

After a successful upgrade:

```sql
-- new version stamped, with the upgrade in history
SELECT snapshot->'foundation'->>'version' AS version,
       snapshot->'foundation'->'history'  AS history
FROM system_capability_registry WHERE tenant_id = '00000000-0000-0000-0000-000000000001';
-- the upgrade is an audited configuration_change (change_reason = 'foundation upgrade')
SELECT change_kind, before_value, after_value
FROM configuration_change WHERE change_reason = 'foundation upgrade' ORDER BY recorded_at DESC LIMIT 1;
-- your vertical is untouched: its kinds + migrations still present
SELECT count(*) FROM private.vertical_migration;             -- unchanged
SELECT count(*) FROM entity_kind_definition WHERE kind_name = '<your vertical kind>';  -- still there
```

Then run `pnpm test:invariants` (with a DB URL) and your vertical's own tests — both
green.

## Failure / recovery

The upgrade is **fail-closed**: each migration applies in its own transaction, so a
broken core migration rolls back fully (nothing half-applied) and the run aborts
**before** stamping. If `pnpm upgrade` exits non-zero:

1. **Nothing was stamped** — the clone's recorded version is still the old one. The
   database is at the last *successfully*-applied migration; the failing one left no
   partial state.
2. **Diagnose:** the failing step is printed. A migration failure means the core
   migration is incompatible with this clone's data — that violates the additive-only
   contract and is a **foundation bug**; report it, do not hand-patch the migration
   in the clone (your edit will be overwritten by the next upgrade).
3. **Recover the working tree:** the sync (step 4) staged foundation files. To roll
   the *code* back to pre-upgrade, `git restore --staged --worktree -- <FOUNDATION_PATHS>`
   (or `git checkout HEAD -- …`). The database needs no rollback — the failed
   migration didn't apply.
4. **Re-run** once the foundation ships a fixed release. The upgrade is idempotent:
   already-applied migrations are skipped; an unstamped clone re-attempts cleanly.

Never bypass the invariant-suite gate to "force" an upgrade through — a red suite
after an upgrade means the upgrade broke a guarantee, which is exactly what the gate
exists to stop.

## Pointers to ground truth

`adr/0043-clone-upgrade-path.md` (the contract + namespaces), `docs/UPGRADE_PATH.md`,
`scripts/upgrade-foundation.mjs`, `scripts/migrate-vertical.mjs`, the `newplatform`
skill (which stamps clones at creation).
