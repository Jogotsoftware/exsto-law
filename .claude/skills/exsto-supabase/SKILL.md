---
name: exsto-supabase
description: The Exsto way of using Supabase/Postgres as the substrate database (ADR 0026) — forward-only migrations, RLS on every table, apply via MCP, never bypass with service_role. ALWAYS consult this when applying or writing migrations, provisioning a project, configuring client keys, running advisors, or doing anything with the Supabase MCP/CLI for an Exsto project.
---

# Using Supabase under Exsto

Supabase Postgres **is** the substrate (ADR 0026) — it is not a generic app database, and the substrate's guarantees are enforced *in* it (RLS, append-only triggers, anon lockdown). So the rules here are tighter than ordinary Supabase usage: the database is the source of truth and must never be edited out-of-band in a way that drifts from the migration files.

## Migrations are the schema

- **Forward-only.** Files are `NNNN_descriptive_name.sql`, zero-padded, sequential. Once merged, a migration is **never modified or reordered** — fix a mistake with a new migration.
- **Apply** with the Supabase MCP `apply_migration` (web/remote) or `supabase db push` (local). Before changing schema, `list_tables` to see current state; after, run `get_advisors` and expect it clean.
- **Self-record.** End every migration with `SELECT public.sync_migration_history();` so `public.schema_migration` stays the queryable ledger (invariant 12).
- Schema design + RLS shapes live in **exsto-substrate-migration** — follow it for any structural change.

## RLS and roles are not optional

- Every table has `tenant_id` and RLS enabled with `tenant_id = current_setting('app.tenant_id', true)::uuid` policies.
- App/runtime/MCP code connects as a **non-owner role** (`authenticated`) and sets `app.tenant_id` per request/job (ADR 0037). There is no "admin bypass" path in production code.
- **Never reach for `service_role` to "just get it working."** BYPASSRLS hides isolation and lets you mutate append-only/sealed rows; it is for migrations/admin only, with explicit logging.

## Reads, keys, and the rest

- Client config: `get_project_url` + `get_publishable_keys`. The publishable/anon key is write-locked by migration `0019` (anon has zero INSERT/UPDATE/DELETE).
- **Seed** dev data in `supabase/seed/` (idempotent: fixed UUIDs + `ON CONFLICT DO NOTHING`).
- **Edge Functions** (`supabase/functions/`) are rare — only low-volume webhooks. Substrate logic belongs in MCP tools + the worker, not edge functions.
- Prefer the MCP tools directly in this web/remote environment; `apply_migration` goes straight to the remote project, so review SQL first.

## Gotchas

- **A schema change applied but not committed to a migration file = drift.** The next clone won't have it. Always land the SQL as a migration file too.
- **`get_advisors` warnings (missing RLS, exposed tables) are blockers,** not noise — the substrate's promise is isolation.
- **Project refs are real and distinct:** the clean substrate target is `exsto-dev` (`vjpqtzxtxhisbuaerfbb`); the legal wedge is `exsto-wedge`. Confirm which project before applying anything.

## Pointers to ground truth

- `supabase/CLAUDE.md`, `supabase/migrations/`, `supabase/seed/0001_initial_data.sql`.
- ADRs 0026 (Supabase as substrate DB), 0037 (RLS role model); exsto-substrate-migration, exsto-verify-tenancy.

## Verify

After any Supabase change: `get_advisors` is clean; `SELECT count(*) FROM public.schema_migration WHERE entry_kind='migration'` equals the number of migration files; every public table reports `relrowsecurity = true`; and the working tree contains a migration file for the change you just applied (no out-of-band drift).
