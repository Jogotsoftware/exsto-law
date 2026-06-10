# Exsto Clone Upgrade Path

**Date:** 2026-06-10
**Status:** implemented and drilled (the last gate before client cloning — see
`docs/FOUNDATION_CERTIFICATION.md`). Governed by ADR 0043.

How an existing clone — a fork that has grown its own Layer-3 vertical — receives
foundation updates (new core migrations, substrate fixes) **without clobbering its
vertical**, verified by a live drill.

---

## The model (ADR 0043)

- **Distribution: git playbook.** A clone carries the substrate *source* (workspace
  packages), so it receives updates by syncing the foundation-owned paths from a
  `foundation` git remote at a tagged version — not by bumping an npm dependency.
  Packages are semver-versioned (`VERSION` = source of truth) and a publish workflow
  is wired for the future externalized-consumer case.
- **Compatibility contract: additive-only.** The foundation never drops/renames a
  table, column, function, or kind a vertical can touch; new columns are
  nullable/defaulted; released migrations are immutable; a breaking change is a
  **major** bump with a written guide (`docs/upgrades/<from>-to-<to>.md`) the runner
  enforces.
- **Two migration namespaces.** Core (`supabase/migrations/`, foundation-owned,
  stock `supabase db push`) and vertical (`supabase/migrations_vertical/`,
  clone-owned, `scripts/migrate-vertical.mjs` → `private.vertical_migration`
  ledger). Disjoint dirs + disjoint ledgers, so a foundation upgrade's new core
  migrations never collide with a clone's migrations. (This is the exact failure
  the legacy `exsto-dev` ledger shows — timestamp-named migrations that no longer
  match the repo's sequential names; two namespaces make it impossible.)
- **Version stamp + audit.** Every clone records its foundation version in
  `system_capability_registry` at bootstrap (`scripts/stamp-version.mjs`); every
  upgrade bumps the stamp (with history) and writes a `configuration_change`.

## Using it

```bash
# bootstrap (newplatform does this):
DATABASE_URL=… node scripts/stamp-version.mjs
git remote add foundation https://github.com/Jogotsoftware/exsto.git

# upgrade (the exsto-upgrade-foundation skill):
DATABASE_URL=… pnpm upgrade                                   # to foundation/main
DATABASE_URL=… node scripts/upgrade-foundation.mjs --to v1.1.0
```

The runner (`scripts/upgrade-foundation.mjs`): read current version → fetch target
→ semver gate (no downgrade; major needs a guide) → sync foundation-owned paths
(never `verticals/`, the vertical app, `supabase/migrations_vertical/`, `.env.local`)
→ install + build → apply core (`db push`) + the migration-history catch-up + vertical
migrations → **invariant suite gate** → stamp + `configuration_change`. Fail-closed:
each migration is its own transaction; a failure aborts **before** stamping.

---

## Drill (the proof)

A scratch clone was cut at **v1.0.0** via the bootstrap flow, given a **vertical
life** (a `widget` entity kind, a vertical-namespace migration `0001_widget_index`,
and a widget entity), then upgraded to a foundation **v1.1.0** carrying a benign new
core migration (`0027`, an additive index).

### Success drill — PASS (hands-free, zero manual fixes in the final run)

| Assertion | Result |
|---|---|
| Core migration applied by the upgrade | `action_recorded_at_idx` (0027) present |
| Invariant suite after upgrade | **33 / 33** |
| Stamp bumped | 1.0.0 → **1.1.0** (history length 1) |
| Upgrade audited | `configuration_change` (`update`, reason "foundation upgrade", → 1.1.0) |
| **Vertical migration untouched** | `0001` still in `private.vertical_migration` |
| **Vertical kind untouched** | `widget` present |
| **Vertical data untouched** | widget entity intact |
| **Vertical index untouched** | `vtl_widget_name_idx` present |
| Migration ledger consistent | public 27 = CLI 27 |

### Failure drill — PASS (fail-closed, nothing half-applied)

Upgrading to a **v1.1.1** carrying a deliberately broken core migration (`0028`,
references a non-existent column):

| Assertion | Result |
|---|---|
| Upgrade failed loudly | `ERROR: column "this_column_does_not_exist" does not exist`, runner aborted |
| Stamp NOT bumped | still **1.1.0** |
| Broken migration NOT applied | `broken_idx` absent |
| Broken migration NOT in ledger | 0028 absent; ledgers still 27 = 27 |
| No upgrade recorded | history length still 1 |
| Recovery procedure | documented in the `exsto-upgrade-foundation` skill |

### Three runner bugs the drill caught (and fixed) before any client cloning

The drill earned its keep — it surfaced three real defects in the runner, each fixed
and re-run to green:

1. **`sh()` crashed on `stdio:'inherit'` steps** — `execSync` returns `null` there;
   `.toString()` threw. (Caught at the install/build step.)
2. **Missing migration-history catch-up after `db push`** — `db push` records a
   migration in the CLI ledger *after* running it, so the final migration's own
   `sync_migration_history()` ran too early and `public.schema_migration` missed it
   (invariant 12). The runner now runs the catch-up sync, mirroring `seed 0002`.
3. **`configuration_change.change_kind` is constrained** to create/update/deprecate;
   the upgrade now records as `update` with reason "foundation upgrade".

In every failure the **fail-closed behaviour held**: the run aborted before stamping,
and nothing was half-applied.

---

## The one gate this closes — and what remains

This closes the **upgrade-path** gate from the foundation certification. A clone can
now be created hands-free, given a vertical, and upgraded hands-free, with its
vertical provably untouched and the invariant suite as the gate. The first client
clone (exsto-law) can proceed.

Deferred (follow-ups, not gates): a pre-upgrade check that the clone never edited a
foundation-owned path (the contract forbids it; the sync's overwrite is the blunt
enforcement); and registry publishing as the primary distribution (blocked by the
`@exsto` scope — git playbook is today's path).
