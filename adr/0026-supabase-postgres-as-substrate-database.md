# ADR 0026: Supabase-managed Postgres as the substrate database

## Status
Accepted

## Context
The substrate's database choice constrains everything else. Requirements:

- Strong support for row-level security (the tenancy mechanism per ADR 0001).
- Mature SQL with windowing, recursive CTEs, JSONB, full-text search, and time functions.
- Operational maturity: backups, point-in-time recovery, replicas.
- Reasonable cost at small scale, with a path to larger scale.

Postgres meets these requirements. It has the strongest RLS implementation of mainstream databases, a deep feature set, and well-understood operational characteristics.

The deployment options are: self-hosted Postgres, managed Postgres (RDS, Cloud SQL, Supabase, Neon), or Postgres-compatible serverless (CockroachDB, Yugabyte, Aurora).

## Decision
Supabase-managed Postgres.

Reasons:
- Postgres-native (not a Postgres-compatible reimplementation). Full feature set including RLS.
- Authentication, storage, and edge functions bundled. Reduces the operational surface for the founder running this solo.
- Reasonable free tier for development. Pricing scales linearly to medium scale.
- Migration path to self-hosted Postgres or other managed providers is straightforward (it's standard Postgres underneath).
- Real-time subscription support out of the box, useful for the reference app and any future live UI surfaces.

Application code uses the standard `pg` driver (or `postgres-js`), not Supabase-specific client libraries, for substrate operations. The Supabase JavaScript client is used only for auth flows in the reference app. This keeps the substrate code portable; if we move off Supabase later, only the auth integration needs to change.

Schema migrations live in `supabase/migrations/` as forward-only SQL files. The Supabase CLI can apply them, but we are not locked into the CLI; the migrations are standard SQL.

## Consequences

What's now easier:
- Bootstrap. A new developer signs up for Supabase, copies env vars, runs migrations. Working in 10 minutes.
- Auth. Supabase Auth handles user signup, magic links, OAuth providers without us building auth.
- Real-time. Real-time subscriptions on certain tables come for free.
- Cost. Free tier covers development; paid tier scales reasonably.

What's now harder:
- Vendor relationship. We rely on Supabase's reliability and pricing decisions. Mitigated by the portability of the schema and queries (standard Postgres).
- Performance tuning. Supabase exposes most Postgres tuning knobs but not all. If we hit tuning limits, we'd move to self-hosted.
- Specific Supabase features (edge functions, real-time channels) create soft lock-in if used heavily. Discipline: use the bundled features only where the substitution is easy.

## Alternatives considered

**Self-hosted Postgres on a cloud provider.** Considered. Maximum control, more operational work. The bundled features Supabase provides (auth, real-time) would be re-implemented. Not worth it for solo founder bandwidth at this stage.

**RDS or Cloud SQL.** Pure managed Postgres. Less bundled functionality. Higher operational cost for less benefit.

**Neon.** Postgres-compatible with serverless scaling. Newer; less mature. Real-time and auth not bundled.

**CockroachDB or Yugabyte.** Postgres-wire-compatible distributed databases. Add complexity not yet needed. Performance characteristics differ in edge cases. Reconsider when scale demands it.

**SQLite via Turso or Cloudflare D1.** Considered for development simplicity. Production substrate needs are larger; SQLite limits concurrency and feature set.
