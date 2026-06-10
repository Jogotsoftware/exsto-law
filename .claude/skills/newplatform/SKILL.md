---
name: newplatform
description: Use to stand up a BRAND-NEW project/tool on the Exsto substrate. ALWAYS use this when starting a new platform, spinning up a new product, or "cloning the foundation" — it reproduces the full substrate by cloning the template repo and replaying existing migrations onto a fresh database, WITHOUT rebuilding anything. Trigger on "/newplatform", "new project", "new tool on the substrate", "start a new platform".
---

# /newplatform — clone the foundation, don't rebuild it

A new platform is a **clone of the foundation, not a rebuild.** Everything already exists — the substrate schema, MCP server, worker, skills, and invariants. Your job is to reproduce them cheaply and correctly on a fresh repo + fresh database, then hand off to the human. This is a fixed recipe: do not explore the repo or re-derive the substrate (that wastes tokens). Run the sequence, verify, ask.

**Key principle — the migrations are the clone.** Never `pg_dump`/copy the live foundation database (that drags test data and drift). Instead, replay the existing migration files onto a new, empty database. That reproduces the entire substrate in seconds.

## Prerequisite

The foundation repo must be marked as a GitHub **template repository**. The canonical foundation is `github.com/Jogotsoftware/exsto`; the blessed branch is **`main`** (the substrate line was merged to main; the old `core-substrate` branch is frozen — do not start from it).

## Steps

1. **Clone the code.** Create the new repo from the template:
   `gh repo create <new-name> --template <foundation-repo> --private --clone`
   This copies all substrate code, migrations, MCP server, worker, `.claude/` skills, and `CLAUDE.md`. Verify it's a clean copy.
2. **Create a fresh database.** Use the Supabase MCP: `confirm_cost` → `create_project` (new project, `us-east-1`). This is the new platform's OWN database — never reuse the foundation's DB.
3. **Replay the substrate (CORE migrations).** Apply the repo's `supabase/migrations/` in order to the new project (`supabase db push`). This is the **core** sequence; the **vertical** sequence (`supabase/migrations_vertical/`, empty on a fresh clone) is applied by `node scripts/migrate-vertical.mjs` and is where the clone — never the foundation — authors its own migrations (ADR 0043). Confirm `public.schema_migration` ends up populated (each migration calls `sync_migration_history()`).
4. **Wire the app.** Pull the new project's URL + keys (`get_project_url`, `get_publishable_keys`) into the new repo's env/config. Update project identity (name in `package.json`, README, app config) so this is a NEW project, not a copy of the old one's identity.
5. **Bootstrap tenant zero.** Create the initial tenant + actor (use the **exsto-bootstrap-tenant** skill — replay `supabase/seed/0001_initial_data.sql`). No half-formed tenants.
6. **Stamp the foundation version + wire the upgrade remote.** Run `DATABASE_URL=… node scripts/stamp-version.mjs` so the clone records which foundation version + commit it is on (`system_capability_registry`), and add the upgrade remote: `git remote add foundation https://github.com/Jogotsoftware/exsto.git`. This is what makes the clone upgradable later via **exsto-upgrade-foundation**.
7. **Verify the clone — do not trust it.** Run the invariant suite against the new DB and the **exsto-verify-tenancy** checks: anon has zero access, append-only triggers present and raising, bitemporal guards present, RLS isolates tenants, `schema_migration` matches the migration count. Proceed only when green.
8. **Confirm a clean base.** Only the generic seed kinds should be present — entity kinds `contact, deal, document, location, organization, person`; the generic attribute/relationship/action kinds — and no leftover sample or vertical data.
9. **Stop and hand off.** Report what was created (including the stamped foundation version), then ask the human: **"Foundation is live on `<new project>`. What do you want to build?"** Wait for their answer — do not start building a vertical on your own. When you DO build, author schema in `supabase/migrations_vertical/`, never in `supabase/migrations/`.

## Pointers to ground truth

`ARCHITECTURE.md`, `supabase/migrations/`, `supabase/seed/0001_initial_data.sql`, the **exsto-bootstrap-tenant** and **exsto-verify-tenancy** skills. Confirm exact commands (migration apply, env var names) against the repo before running.

## Verify

The new Supabase project passes the invariant suite, has the generic seed kinds and a bootstrapped tenant zero, and the new repo's config points at the new project — all without having modified any substrate code or migration (`git diff --stat` touches only identity/config files).
