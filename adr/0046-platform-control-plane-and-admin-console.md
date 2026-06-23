# ADR 0046: Platform control plane and admin console

## Status

Accepted. Implemented in the legal clone (`exsto-law`) as a Layer-3 concern:
control-plane schema in `supabase/migrations_vertical/` (0095–0100), control-plane
operation core in `verticals/legal/src/controlPlane/`, admin auth + `/admin` surface
in `apps/legal-demo`. Companion to ADR 0024 (MCP as primary interface), ADR 0037
(RLS role model), ADR 0038 (REST adapter), ADR 0043 (clone upgrade path / migration
namespaces).

## Context

`exsto-law` runs live with real firm tenants. Everything is tenant-scoped: a firm is
a `tenant`, a user is an `actor`, and Postgres RLS isolates them (ADR 0001). There is
no platform-operator surface — no way for the operator (the founder) to see all
firms, stand up a new firm, turn features on/off per firm, or build something in a
safe place before exposing it to real firms.

This collides with two hard rules in CLAUDE.md:

- **Rule 2** — "There is no 'admin override' path in production code." Every query is
  tenant-scoped; RLS on `tenant` is self-select-only.
- **Rule 9** — clients never touch the substrate directly; no `service_role`, no
  request-supplied tenant id.

A platform console must, by definition, (a) read the registry of *all* tenants and
(b) act *across* tenants. The design problem is to add that capability **without**
opening a broad override path that weakens the trust model.

The substrate already solved the structurally identical problem once: the REST
adapter must resolve a presented API key to its `(tenant, actor)` *before it knows
the tenant* — an inherently cross-tenant read. ADR 0037 / migration 0024 solved it
with a **narrow `SECURITY DEFINER` function in the `private` schema**, callable by
the non-owner `authenticated` role, that returns only the principal and never exposes
a table. PostgREST exposes only `public`/`graphql_public`, so a `private` function is
unreachable over the data API. This ADR reuses that exact shape for the control
plane.

## Decision

### 1. The control plane is narrow and audited, not an override

The control plane has exactly three powers, and nothing else:

1. **Read the tenant registry** (list/get tenants).
2. **Tenant lifecycle** — bootstrap a new tenant; suspend / archive / activate one.
3. **Per-tenant configuration operations** — run by *impersonating the target
   tenant's normal `ActionContext`* and going through `submitAction`, exactly as that
   tenant's own UI would.

Powers (1) and (2) are the only cross-tenant capabilities, and they live solely in
guarded `private` `SECURITY DEFINER` functions. Power (3) uses **no override at all**
— it sets `app.tenant_id` to the target via `withActionContext`/`submitAction`, so
RLS engages for the target and every write is an ordinary, append-only `action` row
in that tenant.

### 2. The privileged surface: guarded `private` functions

Mirroring `private.auth_resolve_api_key` (0024). Every function first calls
`private.is_platform_admin(p_actor_id, p_platform_tenant)` and returns nothing / raises
if the caller is not a registered platform admin:

- `private.is_platform_admin(actor, tenant) → boolean` — the guard.
- `private.cp_list_tenants(platform_actor) → setof tenant` — the only legitimate
  "list all tenants" path. `tenant` RLS (self-select-only) is left **untouched**.
- `private.cp_get_tenant(platform_actor, tenant_id)`.
- `private.cp_bootstrap_tenant(platform_actor, new_tenant_id, name, owner_email, …)`
  — inserts the `tenant` row (which `authenticated` otherwise cannot, as `tenant` has
  no INSERT policy), its system/owner/agent actors, RBAC (`provision_firm_rbac`,
  0078/0079), and clones the seven core kind registries (the 0072 idempotent block).
- `private.cp_set_tenant_status(platform_actor, tenant_id, status)` — the **sole**
  writer of `tenant.status`. No broad UPDATE policy is added to `tenant`.

These are granted to `authenticated` and called via `withAppRole` (no tenant
binding), so the deployment never needs owner/BYPASSRLS rights for the control plane.
The `platform_actor` id is derived from a server-verified admin session cookie, never
from a request body.

### 3. Where the platform lives

A reserved **platform tenant** `00000000-0000-0000-00FF-000000000001` holds the
platform-admin actors and the control-plane audit log. It is an ordinary tenant for
RLS purposes — nothing about it bypasses anything; it is simply where platform admins
are actors. A reserved **sandbox tenant** `00000000-0000-0000-00FE-000000000001`
(ADR §6) holds the build-everything environment.

### 4. Two complementary audit trails

- `public.control_plane_action` (append-only, `no_update`/`no_delete`, under
  platform-tenant RLS) records *who-did-what-across-tenants*: the platform admin, the
  operation, the target tenant, payload + result. Every control-plane entry point
  writes one row.
- Per-tenant operations (power 3) additionally produce a normal `action` row **in the
  target tenant**, authored by a dedicated per-tenant `platform` actor so the target's
  own audit honestly reads "authored by the platform console." The
  `control_plane_action` row is the cross-reference linking the two.

### 5. Modules are config-as-data

A "module" is a named **feature bundle** (`billing`, `client-portal`, `e-sign`,
`calendar`, `documents`, `crm`, `matters`). The catalog (`module_definition`) and
per-tenant state (`module_enablement`) are rows, not code (invariant 12). A module's
`requires` manifest declares the definition rows it installs as a list of `*.define`
action payloads; enabling a module **replays each through that tenant's
`submitAction`** with the matching define handler (`kind.define`,
`permission_scope.define`, `workflow.define`, …). The module gates the UI via its
`ui_areas` and gates capability by being the thing that installs the kinds/scopes.
Disable deprecates scopes and hides UI but never deletes data-bearing kinds.

### 6. Sandbox + promotion by replay

The sandbox tenant has all modules enabled; anything can be built and tested in it
through the normal attorney app. **Promotion** reads selected config from the sandbox
(a guarded read-only `cp_export_config` / `cp_diff_config`) and, for each item,
**replays it through the TARGET tenant's `submitAction`** with the corresponding
`*.define` kind — never a cross-tenant `INSERT … SELECT`. Promotion is idempotent on
stable *names* (not source UUIDs, which are regenerated per tenant); workflow
promotion writes a new version and deprecates the prior (honoring invariant 17 —
in-flight instances stay bound to their started version). A dry-run diff precedes any
write.

### 7. Admin auth is a separate boundary

- Identity reuses Google OAuth, but the admin session is a **distinct signed cookie**
  (`exsto_admin_session`) with a domain-separated MAC prefix (`admin.session.v1:`), so
  an attorney session can never be replayed as an admin session or vice-versa (same
  trick `lib/session.ts` already uses). Shorter TTL.
- Authority is the `platform_admin` table, re-checked live on every request (a revoked
  admin with an unexpired cookie is rejected) — mirroring `resolveAttorneyCtx`.
- The `/admin/api/mcp` route default-denies against an `ADMIN_CONSOLE_TOOLS` allowlist
  (mirroring `clientPolicy.ts`); admin tools are unreachable from the attorney route
  and vice-versa.

### 8. Namespace: vertical, not core

All control-plane schema lives in `supabase/migrations_vertical/` (clone-owned), not
`supabase/migrations/` (foundation-owned, clobbered by upgrades — ADR 0043). The admin
console is a Layer-3 concern of this clone. The new tables still obey every substrate
invariant (RLS + `tenant_id` + append-only where they hold history); the invariant
suite covers them.

## Consequences

**Enables**
- The operator can see all firms, create one, toggle features per firm, and build in a
  sandbox before promoting to production — all from one console.
- Every cross-tenant capability is one narrow, guarded, named function; every action is
  audited on both the platform side and the target-tenant side.

**Obligations / invariants preserved**
- No broad RLS policy is added to `tenant`; no `service_role`; no request-supplied
  tenant id. Cross-tenant reads/writes are confined to guarded `private` functions;
  per-tenant operations go through `submitAction` with an impersonating context.
- `control_plane_action` is append-only. Module disable and promotion never UPDATE
  history or delete data-bearing kinds; they use supersession.

**Risks**
- The guard correctness is load-bearing: every `private.cp_*` function must call
  `is_platform_admin` first. Reviewed as a unit; covered by a tenancy test that a
  non-admin `authenticated` caller gets zero rows from `cp_list_tenants`.
- Migration numbers in the vertical sequence are checksum-immutable once applied;
  numbers are picked against `origin/main` + prod just before writing.
