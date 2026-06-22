# Upgrade request → foundation: promote RBAC scope enforcement to the core

**From:** Worker S9 (Tenancy & RBAC), clone `exsto-law` (v1.0.3)
**Status:** request — implemented in this clone as a leased migration; needs adoption upstream
**Relates:** ADR 0024/0038 (one operation core), ADR 0001 (tenancy), ADR 0022 (governance gradients), CLAUDE.md hard rules 1–9

## Why this is a request, not an in-place core edit

S9 was scoped to *provision + enforce + wire UI* on the existing RBAC primitives
without touching foundation **code**. The natural place to enforce permissions is
the operation core (`packages/substrate/src/action.ts` `submitActionInner`), which
is off-limits to this worker. Per the agreed path, the enforcement was implemented
at the **database layer** (a leased migration, `0073`), which is where the
substrate already enforces tenancy — and this document requests that the same
mechanism be folded into the foundation so every clone inherits it.

## What S9 shipped in this clone (the reference implementation)

- **`supabase/migrations_vertical/0073_rbac_scope_enforcement.sql`** — a
  clone-level (vertical) migration, so the foundation core is untouched; runs
  after the seed via `scripts/migrate-vertical.mjs`. `AS RESTRICTIVE` RLS
  policies that gate **writes** (the `action` INSERT, by `action_kinds`) and
  **reads** (`entity`/`attribute`/`relationship`, by `entity_kinds`) against the
  acting actor's `actor_scope_assignment` rows. Helpers live in the `private`
  schema (like `private.auth_resolve_api_key`) so PostgREST does not expose them.
  **Opt-in model:** an actor with zero active scope assignments is *unrestricted*
  (backward-compatible); a scope assignment restricts them to the union of their
  scopes. `'*'` = all.
- **`0074_seed_firm_rbac_config.sql`** — bootstrap of the firm's roles/scopes and
  the owner's admin grant (clone-specific data; not for upstream verbatim).
- **`0075_user_management_action_kinds.sql`** + `verticals/legal` handlers/tools —
  `legal.user.invite` / `legal.user.assign_role` / `legal.user.deactivate`, the
  vertical's adapter over the primitives.

## Requested foundation changes

1. **Adopt `0073` as a foundation migration.** Promote the scope-enforcement RLS +
   `private` helpers into the core migration set so every clone gets write/read
   RBAC enforcement by default. The opt-in model means existing clones are
   unaffected until they assign a scope.

2. **Add a typed pre-check in `submitActionInner`** (`packages/substrate`). Today a
   blocked write surfaces as a raw Postgres RLS error (`42501`). The core should
   consult the actor's scopes *before* the INSERT and raise `GovernanceDenied`
   (the error class already exists in `@exsto/shared`) with a readable message,
   keeping the RLS policy as the un-foolable backstop (defense in depth).

3. **Promote actor lifecycle to foundation primitives.** `actor.create` /
   `actor.deactivate` and a `actor_scope.revoke` (bitemporal close) are
   substrate-level concerns; S9 implemented them as vertical `legal.user.*`
   handlers only because the core was off-limits. Promote them so all verticals
   share one user-management vocabulary.

4. **Extend the read gate to `judgment` / `outcome` / `event`.** S9 gated the three
   primary state tables (`entity`/`attribute`/`relationship`). The same
   `private.actor_may_read_entity(_kind)` helpers extend to judgments/outcomes/
   events (resolve their entity and reuse the helper).

5. **Wire `permission_scope_definition.row_filter_expression`.** It exists but is
   inert. A compiler from that JSON into an additional RLS predicate would give
   per-row (not just per-kind) read control.

## Backward compatibility & risk

- **No behavior change until a scope is assigned** (opt-in restriction model);
  verified that an unrestricted actor still sees all rows and an admin (`firm.admin`
  `'*'`) keeps full read+write.
- **`RESTRICTIVE` policies** AND-combine with the existing permissive tenant
  policies — they can only *narrow*, never widen, access.
- Owner/`service_role` (BYPASSRLS) and the migration role are unaffected; the
  runtime's `authenticated` role (ADR 0037) is where it bites.

## Verification (DB-gated invariant suite, as the `authenticated` role)

The durable receipt is `tests/invariants/rbac-enforcement.test.ts`, run by the CI
`invariants` job against a real Postgres (full RLS, all migrations applied) — no
prod writes. Migration 0078 turned the WP9.2 starter set into the role ladder and
the suite now asserts, under `authenticated`:

- **P1:** a human with no scope can neither act nor read; a non-human (agent) with
  no scope stays unrestricted (jobs/seed keep working).
- **Paralegal:** `entity.create` / `matter.open` → allowed (full practice read);
  `invoice.issue` (billing) and `kind.define` (governance floor) → rejected.
- **Attorney:** `invoice.issue` → allowed; `legal.user.assign_role` and
  `kind.define` → rejected by the escalation floor (admin-only).
- **Admin / super_admin:** pass the escalation floor (user mgmt + governance).
- `get_advisors(security)` → clean after moving helpers to `private`.

(The earlier one-off through-core receipt scripts were removed — they wrote to the
live DB and asserted the pre-0078 2-tier behaviour; the CI suite supersedes them.)
