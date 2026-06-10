---
name: exsto-rest-api
description: Expose Exsto's own functionality as a REST/OpenAPI surface — endpoints external tools, partners, or clients that can't speak MCP call into. ALWAYS consult this before adding any HTTP route that reads or writes Exsto data, building a public API or OpenAPI spec, or wiring a non-MCP client, because REST is allowed ONLY as a thin adapter over the same operation core the MCP server uses (ADR 0038) — never a parallel CRUD layer running its own SQL against the substrate. Trigger on "Exsto REST API", "expose endpoints", "public API", "OpenAPI", "API for an external tool/client".
---

# Exposing Exsto as a REST API

REST is a **second front door to the same house, not a second door to the database.** The invariant it must respect: *no client touches the substrate tables directly — every client goes through the one operation core where tenancy, append-only, provenance, and reasoning are enforced* (ADR 0038, amending ADR 0024). The MCP server (`apps/mcp-server`) is the primary adapter on that core; a REST API is a **sibling adapter on the same core.** There is no REST adapter in the repo yet — when you build one, mirror the MCP adapter; do not invent a parallel path.

## The one rule
A REST handler does auth + input validation + response shaping, then **delegates to the exact same operation an MCP tool would call** — `submitAction(ctx, ...)` (or a primitive facade) for writes, the `packages/primitives` query helpers / `executeQuery(ctx, sql, params)` for reads. It must NEVER issue its own `INSERT`/`UPDATE`/`DELETE` against `entity` / `attribute` / `event` / `relationship` / … . A handler writing raw substrate SQL has become the forbidden parallel CRUD layer — stop.

## What every endpoint must do
1. **Delegate to the core.** Build `ctx: ActionContext = { tenantId, actorId }` and call the same primitive an MCP tool uses (`createEntity`, `setAttribute`, `recordJudgment`, `submitPrimitiveAction`, …) or read helper (`getEntityContext`, `getCurrentAttributes`, `listRelationships`, …). One core, two adapters; they must not drift.
2. **Authenticate, then derive tenant server-side.** API keys / OAuth identify the caller; resolve `tenantId` + `actorId` from the authenticated principal — **never** from a request body or query field. DB access runs as the `authenticated` role with `app.tenant_id` bound by `withActionContext` / `withTenant` (which run `set_config('app.tenant_id', $1, true)`); never expose `service_role` over HTTP.
3. **Reads follow the bitemporal rules** (current-state / as-of / full history; carry knowability, confidence, provenance, polarity) — see exsto-query-substrate.
4. **Writes go through actions and stay append-only** — every write becomes exactly one `action` row via `submitAction`; never an endpoint that UPDATEs or DELETEs a historical row. Corrections are new versions/events (exsto-add-kind, exsto-substrate-migration).
5. **AI-driven endpoints capture reasoning**, same as MCP — persist the trace, pass `reasoningTraceId` (exsto-ai-operation).

## Mirror the MCP adapter (the proven sibling)
The MCP server is the reference to copy, not improve on. `apps/mcp-server/src/mcp.ts` builds `ctx` from `{ tenantId, actorId }` and calls `tool.handler(ctx, input)`; the handlers live in `packages/mcp-tools/src/tools/`. A REST route is the same shape with an HTTP skin: `POST /v1/entities` takes the body the `entity.create` tool takes and calls `createEntity(ctx, …)`; `GET /v1/entities/:id/context` calls `getEntityContext(ctx, id)`. Generate the OpenAPI spec from the same action/tool catalog (`getTools()`) so REST and MCP cannot diverge.

## REST cross-cutting concerns
Versioning (`/v1`), pagination, idempotency keys on writes, consistent error shapes, rate limiting, and an OpenAPI spec derived from the action/tool definitions — added in the adapter, never leaked into the core.

## Anti-patterns — reject these
- A REST handler running raw SQL against substrate tables (the cardinal violation).
- Trusting a `tenant_id` from the request instead of the authenticated principal.
- An endpoint that edits or deletes history (`UPDATE`/`DELETE` on `attribute` / `action` / `event` / …).
- Implementing REST separately from MCP so the two drift.
- Surfacing `service_role`-level access over HTTP.

## Pointers to ground truth
- ADR 0038 (operation core; MCP + REST as sibling adapters); ADR 0024 (amended).
- The operation core: `packages/substrate/src/{action,context,query}.ts` (`submitAction`, `withActionContext`, `executeQuery`); `packages/primitives/src/*` (facades + `queries.ts`).
- The sibling adapter to mirror: `apps/mcp-server/src/{index,mcp}.ts`, `packages/mcp-tools/`. Skills: exsto-mcp-tool, exsto-mcp-spec, exsto-query-substrate, exsto-ai-operation, exsto-verify-tenancy.

## Verify
A REST write produces the **same `action` row** and the **same tenant-scoped effects** as the equivalent MCP call:

```sql
-- after a REST POST that should create one action of kind <k>:
SELECT count(*) FROM action
 WHERE action_kind_id = (SELECT id FROM action_kind_definition WHERE kind_name = '<k>')
   AND tenant_id = current_setting('app.tenant_id', true)::uuid;   -- exactly one more than before
```

- The same call authenticated as tenant A cannot read or write tenant B's rows — run the exsto-verify-tenancy isolation checks against the REST surface.
- No handler issues substrate SQL directly: `git grep -nE "INSERT|UPDATE|DELETE" <rest-handler-dir>` is empty (writes go through `submitAction`).
- The OpenAPI spec matches the action/tool catalog, and no endpoint mutates history.
