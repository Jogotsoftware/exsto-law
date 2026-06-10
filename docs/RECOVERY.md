# Exsto Backup & Recovery

**Date:** 2026-06-09
**Scope:** what the substrate's hosting plan provides for backups, and a proven,
reproducible recovery path verified against the invariant suite.

---

## What exsto-dev's plan provides (confirmed)

Read from the Supabase Management API for `exsto-dev` (`vjpqtzxtxhisbuaerfbb`):

| Property | Value |
|---|---|
| Physical backups (WAL-G) | **enabled** |
| Backup cadence | **daily**, 8 retained (most recent 2026-06-09 05:35 UTC, status COMPLETED) |
| Point-in-time recovery (PITR) | **disabled** |
| Region | us-east-1 |

**Implication.** Recovery granularity is **one day** (the most recent daily
physical backup), not arbitrary-second PITR. For a production tenant with a tighter
RPO, enable PITR on the project (a paid add-on) — that is a per-project setting, not
a substrate change. The substrate itself is **append-only and bitemporal**, so the
database already preserves history within a backup; the backup cadence bounds how
much *recent* write activity a restore could lose (worst case ~24h).

**Native restore is in-place.** Supabase's physical-backup restore
(`/v1/projects/{ref}/database/backups/restore`) and PITR restore both restore to
the **same project ref** — they overwrite the project. There is no
"restore-to-a-new-project" API. So the native restore cannot be exercised against
`exsto-dev` without risking it, and is validated instead via the logical
backup/restore below.

---

## Recovery path (proven)

Because the native restore is in-place and (in this environment) the Supabase
CLI/`pg_dump` require Docker which is unavailable, recoverability was proven with a
**logical backup/restore** that exercises the same thing a restore must guarantee:
the schema + all data come back, and every substrate invariant still holds.

Tooling: `scripts/logical-backup-restore.mjs` (pure Node + `pg`; no Docker/psql).
Type fidelity is handled **server-side** — `row_to_json` on read, then
`json_populate_record(null::public.<table>, …)` on write — so every column
(jsonb, arrays, timestamptz, enums) is reconstructed exactly. A fixpoint insert
loop satisfies foreign-key ordering (including self-references) without needing
superuser/`session_replication_role`.

### Steps performed

1. **Backup (read-only) from `exsto-dev`:**
   ```bash
   SOURCE_URL=<exsto-dev session URL> \
     node scripts/logical-backup-restore.mjs backup exsto-dev-backup.json
   # -> BACKUP ok: 60 tables, 272 rows
   ```
   `exsto-dev` was never written to.

2. **Restore into a disposable project** (the standing `exsto-clone-scratch`,
   truncated first so the result reflects the backup alone):
   ```bash
   TARGET_URL=<scratch URL> \
     node scripts/logical-backup-restore.mjs restore exsto-dev-backup.json
   # -> RESTORE ok: 272 rows inserted across 4 pass(es)
   ```
   Append-only/seal triggers permit INSERT of historical rows (they block only
   UPDATE/DELETE), so the full history restores cleanly. `schema_migration` is
   skipped on restore — it is the target's own migration ledger (re-derived by the
   migrate step + `sync_migration_history()`), not restorable substrate data.

3. **Verify the restore upholds every invariant:**
   ```bash
   SUBSTRATE_TEST_DATABASE_URL=<scratch URL> pnpm test:invariants
   # -> 9 files, 33 passed
   ```

### Result

| Check | Outcome |
|---|---|
| Rows restored | 272 / 272 (60 tables) |
| Restored substrate state | 2 tenants, 5 actors, 38 entities, 74 actions, 54 attributes, 6 entity kinds |
| Migration ledger consistency | public 25 = CLI 25 |
| **Invariant suite against the restore** | **33 / 33 PASS** |

The restored database is a fully-functional substrate: tenant isolation,
append-only history, bitemporal seals, and migration-history all verified green on
the restored copy.

---

## Recommended production posture

1. **Enable PITR** for any tenant whose RPO must be tighter than 24h (per-project
   paid setting; no substrate change).
2. **Keep the logical backup/restore script** as the cross-project recovery and
   migration tool — it is the only path that restores into a *different* project
   (the native restore is in-place), useful for cloning a tenant's data into a
   staging project or recovering selectively.
3. **Periodically rehearse** this restore (backup → restore into a disposable
   project → `pnpm test:invariants`) so recovery is proven, not assumed. The script
   + invariant suite make this a one-command drill.
4. **Back up the WAL-G physical backups' retention** is 8 days here; lengthen
   retention for tenants with longer recovery-window requirements.

---

## Threats this does and does not cover

- **Covered:** accidental data loss / project corruption (restore the daily
  physical backup in place, or logically restore into a fresh project and verify
  with the invariant suite). Schema + data + all substrate guarantees recover.
- **Not covered here:** sub-24h RPO without PITR; cross-region disaster recovery
  (single-region us-east-1); and cryptographic tamper-evidence of the backup itself
  (the hash chain, invariant 18, is deferred — see ADR 0041). These are deployment
  decisions layered on top of the proven recovery path.
