---
name: exsto-substrate-migration
description: Invariant-safe schema changes to the Exsto substrate — RLS on every table, append-only/bitemporal protection, anon lockdown, forward-only, self-recorded. ALWAYS consult this before adding or altering anything in supabase/migrations/, before creating a substrate table, or before changing columns on entity/attribute/action/event/judgment/outcome and the registries.
---

# Changing the substrate schema safely

A migration that adds a table but forgets RLS, or makes a log table mutable, doesn't just have a bug — it breaks a guarantee the whole product rests on (tenant isolation, append-only history). Migrations are forward-only (soft rule 4), and every new substrate table must be born tenant-isolated and, where it holds history, structurally immutable. The DB itself enforces these via triggers and grants, not just RLS — because `service_role`/owner have BYPASSRLS.

## Every new table, in order

1. **Create the table** with `tenant_id uuid NOT NULL REFERENCES tenant(id)` and a `tenant_id` index. Match `ARCHITECTURE.md` terminology exactly (`entity_attribute`, not `attributes`).
2. **Enable RLS + tenant-isolation policies** (copy from migration `0001`):
   ```sql
   ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY <t>_select ON <t> FOR SELECT USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
   CREATE POLICY <t>_insert ON <t> FOR INSERT WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
   CREATE POLICY <t>_update ON <t> FOR UPDATE USING (...) WITH CHECK (...);  -- only if the table is mutable
   ```
3. **Classify the table** and wire the matching structural protection (RLS is not enough):
   - **Append-only log** (events, actions, traces, logs): add the table name to the `append_only` array in `0017_append_only_enforcement.sql` so the `zzz_append_only` trigger (`substrate_block_write`) raises on UPDATE/DELETE for *every* role, and `REVOKE UPDATE, DELETE, TRUNCATE`.
   - **Bitemporal fact/state** (`valid_from`/`valid_to`): add it to the `bitemporal` array in `0018_bitemporal_protection.sql` so `zzz_no_delete` + `zzz_seal_guard` enforce "close via `valid_to`, never delete, never edit a sealed row." Corrections are new rows.
   - **Registry/config** (`*_kind_definition`, `*_definition`): versioned via `valid_from`/`valid_to` + `status`; never hard-update a sealed definition (ADR 0017).
4. **Anon stays locked.** `0019_anon_lockdown.sql` already sets `ALTER DEFAULT PRIVILEGES ... REVOKE INSERT/UPDATE/DELETE FROM anon`, so new tables inherit zero anon writes — but verify, and never add a grant back.
5. **Self-record the migration.** End the file with `SELECT public.sync_migration_history();` (invariant 12) so `public.schema_migration` stays the queryable ledger.

## Rules

- **Forward-only.** Migration up always works; down is local-dev convenience only — never relied on for production rollback.
- **No write path outside the action layer.** A migration may seed *definition* rows, but application/runtime writes to substrate tables still go through `submitAction` (hard rule 1).
- **Update the invariant tests.** If a change touches a guarantee, extend `tests/invariants/` to prove the new schema still upholds it (hard rule 10) — see exsto-verify-tenancy.
- **Apply** via the Supabase MCP `apply_migration` (or `supabase db push`); confirm `get_advisors` is clean afterward.

## Gotchas

- **RLS deny-policies do not stop BYPASSRLS roles.** That's why append-only/bitemporal tables also need the triggers in 0017/0018. Policies + triggers + grants together — defense in depth.
- **A new table not added to the trigger arrays is silently mutable** to the owner/service role. Classify every table.
- **`current_setting('app.tenant_id', true)`** — the `true` (missing_ok) matters; without it, a missing setting errors instead of isolating.

## Pointers to ground truth

- `supabase/migrations/0001_bootstrap_tenant_actor_action.sql` — the canonical RLS + append-only policy shapes.
- `0016`–`0019` — `sync_migration_history()`, append-only trigger, bitemporal guards, anon lockdown.
- CLAUDE.md hard rules 1–10; ADRs 0001 (tenancy), 0014 (append-only), 0026 (Supabase).

## Verify

After applying, prove the table is isolated and protected:

```sql
-- RLS on, policies present
SELECT relrowsecurity FROM pg_class WHERE relname = '<t>';                 -- true
SELECT count(*) FROM pg_policies WHERE tablename = '<t>';                  -- >= 1
-- migration recorded
SELECT 1 FROM public.schema_migration WHERE entry_kind='migration' AND version='<NNNN...>';
```

For an append-only/bitemporal table, the relevant `zzz_*` trigger must exist: `SELECT tgname FROM pg_trigger WHERE tgrelid = '<t>'::regclass;`. Then run the `exsto-verify-tenancy` suite green before claiming done.
