# Operation-core audit (2026-06-04)

Verifies the ADR 0038 principle in the built code: **one operation core; every client reaches the substrate only through it; adapters delegate and hold no operation logic.**

## The operation core

| Layer | Package | What it provides |
|---|---|---|
| Action / context / query | `packages/substrate` | `submitAction`, `withActionContext`, `executeQuery`, `withTenant`, HLC. The only write path; binds `app.tenant_id`; enforces append-only/provenance/reasoning. |
| Primitive facades + reads | `packages/primitives` | `createEntity`, `setAttribute`, `recordJudgment`, `submitPrimitiveAction`, … and the read helpers in `queries.ts` (`getEntity`, `getCurrentAttributes`, `getEntityWithCurrentAttributes`, `getEntityContext`, `searchEntities`, …). All reads run under the action context (RLS engaged, read-your-writes). |

Direct database access is confined to this core, the worker runtime (`workers/runtime`), and migration scripts (CLAUDE.md hard rule 9).

## The adapters (delegate only)

| Adapter | Package | Shape |
|---|---|---|
| MCP — generic | `packages/mcp-tools` | `substrateTools.ts` registers 22 tools; every handler is a thin delegation to a `@exsto/primitives` facade. |
| MCP — legal | `verticals/legal/src/mcp` | Vertical tools registering into the same registry (decoupled from the shared package — Q#5). |
| HTTP transport | `apps/mcp-server` | `index.ts` (HTTP routing) + `mcp.ts` (`dispatchMcp` = `findTool` + ctx + `handler`). Transport only. |

## Evidence

`git grep -nE "executeQuery|withActionContext|withTenant|new Pool|from 'pg'|INSERT |UPDATE |DELETE |submitAction\(" -- packages/mcp-tools/src apps/mcp-server/src` returns **nothing** — the generic adapter layers contain no SQL, no DB connection, and no action-layer calls. They reach the substrate only through `@exsto/primitives`.

## The one extraction made

`entity.get` (MCP tool) was the sole place an adapter composed two core reads inline (`getEntity` + `getCurrentAttributes`). Extracted into a core facade `getEntityWithCurrentAttributes(ctx, id)` in `packages/primitives/queries.ts`, so the MCP `entity.get` tool and the future REST `GET /v1/entities/:id` return the **identical** shape from one operation and cannot drift. Behavior-preserving; invariant suite 33/33 green.

## Conclusion

The single shared operation core already exists and both the MCP tool layer and the bespoke HTTP server are already thin adapters. No further extraction was required beyond the `entity.get` composition above. Both new adapters (the spec-compliant MCP transport and the REST/`/v1` surface) delegate to this same core.
