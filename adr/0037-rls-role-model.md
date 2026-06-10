# ADR 0037: RLS role model — apps connect as a non-owner role

## Status
Accepted (2026-06-03)

## Context
Tenancy (invariant 1) and append-only (invariant 14) are enforced by row-level
security policies on every table. But Postgres exempts two kinds of role from
RLS: the table **owner** (unless `FORCE ROW LEVEL SECURITY` is set) and any role
with the **BYPASSRLS** attribute. On Supabase the `postgres`/admin role used for
migrations is in that category. So if application code connects with that role,
RLS is silently inactive and isolation rests on application discipline alone.

Verified on `exsto-dev`: connecting as the non-owner `authenticated` role with
`app.tenant_id` set to the seeded tenant returns its rows; with a different
tenant id it returns **zero** rows. Isolation is real for non-owner roles.

## Decision
1. **Application and MCP-server connections use a non-owner, non-BYPASSRLS role**
   (Supabase `authenticated`/`anon` via PostgREST, or a dedicated `exsto_app`
   login role for direct `pg` connections). RLS is then enforced by the database.
2. **Migrations and seed** run as the owner/admin role (they must create the
   tenant rows that RLS would otherwise block).
3. **The worker runtime** claims jobs across tenants and therefore connects with
   a privileged (owner/BYPASSRLS) role for the claim step only; it binds
   `app.tenant_id` before invoking each handler so handler reads/writes are
   tenant-scoped (the handler path could alternatively use the app role).
4. We do **not** enable `FORCE ROW LEVEL SECURITY` for now: it would subject the
   owner-run seed and the worker's cross-tenant claim to RLS, requiring a
   separate BYPASSRLS role and extra policies, for defense-in-depth that the role
   discipline above already provides. Revisit before any regulated deployment.

## Consequences
- The `DATABASE_URL` the app/MCP server use must point at a non-owner role.
  This is the single operational requirement that makes tenant isolation real.
- A DB-gated test (`tests/invariants/rls-enforcement.test.ts`) creates a probe
  role and asserts cross-tenant isolation, so a regression (e.g. switching the
  app to an owner role) is caught.
- If we later want isolation to hold even for an accidental owner connection, the
  follow-up is `FORCE ROW LEVEL SECURITY` + a dedicated BYPASSRLS admin/worker
  role + a tenant-insert policy for seeding.
