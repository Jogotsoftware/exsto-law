---
name: exsto-bootstrap-tenant
description: Create a new Exsto tenant in the correct order so it is never half-formed — tenant row, then a system/root actor, then the tenant's kind definitions, atomically and idempotently. ALWAYS consult this when standing up tenant zero on a fresh database, onboarding a new tenant, seeding a cloned foundation, or writing/reviewing seed data.
---

# Bootstrapping a tenant

A tenant is only usable once it has (1) its tenant row, (2) at least a system/root actor, and (3) the kind definitions its actions reference. A tenant created without a system actor can perform no action; one without `action_kind_definition` rows fails on the first `submitAction` because the kind lookup returns nothing. So bootstrap the whole set **in one transaction, in dependency order** — never leave a half-formed tenant behind.

## The order (dependencies flow downward)

1. **`tenant`** — `INSERT INTO tenant (id, name, status)`. Use a fixed UUID for tenant zero (`00000000-0000-0000-0000-000000000001`).
2. **`actor`** — at minimum a `system` actor; the core seed also adds human(s) and an `agent` actor ("Claude"). FK `actor.tenant_id → tenant.id`, so this comes after the tenant.
3. **`action_kind_definition`** — the write vocabulary. Without these, no action can be submitted. Seed the generic set (`system.bootstrap`, `entity.create`, `attribute.set`, ... plus the extended governance/structural/communication/verification kinds), each with `default_autonomy_tier` + `reversibility`.
4. **Entity / attribute / relationship / event / judgment / outcome kinds** — the read/write surface the tenant starts with (`entity_kind_definition`, etc.), scoped to this `tenant_id`.

Everything is scoped to `tenant_id` because **kinds are per-tenant** — a kind defined for one tenant does not exist for another. A new tenant needs its own kind rows (or it inherits them only by replaying the seed under its id).

## Idempotent and atomic

Follow `supabase/seed/0001_initial_data.sql` exactly:

- Fixed UUIDs + `ON CONFLICT (id) DO NOTHING` (or `WHERE NOT EXISTS (...)` for the auto-id extended kinds) → re-running is safe.
- `SELECT set_config('app.tenant_id', '<tenant>', false);` at the top so any tenant-scoped `WITH CHECK` policies are satisfied even though the owner-run seed bypasses RLS.
- Run the whole sequence as one unit. A partial bootstrap (tenant but no actor, or actor but no action kinds) is the failure mode this skill exists to prevent.

## UUID scheme (seed convention)

```
tenant    00000000-0000-0000-0000-00000000000N
actors    00000000-0000-0000-0001-00000000000N   (system=1, human=2, agent/Claude=4)
ent kind  00000000-0000-0000-0010-00000000000N
attr kind 00000000-0000-0000-0011-00000000000N
rel kind  00000000-0000-0000-0012-00000000000N
act kind  00000000-0000-0000-0013-00000000000N
evt/jdg/out 0014 / 0015 / 0016
```

## Gotchas

- **No action kinds = dead tenant.** `submitAction` looks up `action_kind_definition` by `(tenant_id, kind_name)`; an empty registry rejects every write. Seed action kinds before trying any action.
- **Agent actor needed for AI.** AI operations require an `agent` actor in the tenant (see exsto-ai-operation).
- **Don't invent a parallel "tenants" concept in app code.** Tenancy is the `tenant` table + `app.tenant_id` + RLS; bootstrapping is data, not a new mechanism.
- **Cloned foundations:** replaying migrations creates the *structure*; the seed creates tenant zero's *rows*. Both must run (see newplatform).

## Pointers to ground truth

- `supabase/seed/0001_initial_data.sql` — the canonical, idempotent bootstrap to copy.
- `supabase/migrations/0001_bootstrap_tenant_actor_action.sql` — the four foundational tables + RLS.
- exsto-add-kind (adding more kinds later); exsto-verify-tenancy (prove the result).

## Verify

A freshly bootstrapped tenant is complete and isolated:

```sql
SELECT (SELECT count(*) FROM actor WHERE tenant_id=$1) AS actors,                       -- >= 1 (a system actor)
       (SELECT count(*) FROM action_kind_definition WHERE tenant_id=$1) AS action_kinds,-- > 0
       (SELECT count(*) FROM entity_kind_definition WHERE tenant_id=$1) AS entity_kinds;-- > 0
```

Then, as the `authenticated` role with `app.tenant_id` set to the new tenant, `substrate.capability.list` returns the seeded kinds and a trivial `entity.create` succeeds — proving the tenant can actually act. Re-running the seed inserts nothing new (idempotent).
