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

- **`supabase/migrations/0073_rbac_scope_enforcement.sql`** — `AS RESTRICTIVE` RLS
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

## Verification (live receipts on the truth DB, as the `authenticated` role)

- Restricted actor: `event.record` write → **rejected** (`42501`,
  `action_scope_enforcement_insert`); `entity.create` write → **allowed**.
- Restricted actor: `firm_settings` reads → **0**, `matter` reads → **4**; owner
  (`firm.admin`) and an unrestricted actor → see all (5 `document_draft`, 1
  `firm_settings`). No regression.
- `get_advisors(security)` → **clean** after moving helpers to `private`.
- Repeatable: `tests/invariants/rbac-enforcement.test.ts` (DB-gated) and
  `scripts/s9-rbac-receipt.mjs` (through the core).
