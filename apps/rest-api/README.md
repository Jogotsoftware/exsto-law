# REST / OpenAPI adapter

A thin REST adapter over the Exsto operation core — a **sibling to the MCP server**, not a second door to the database (ADR 0038). Every endpoint delegates to the exact same operation the MCP tool of the same name calls (`findTool(name).handler(ctx, input)`); it issues **no substrate SQL**.

## Generated from the catalog (no drift)

The whole surface is generated from the `@exsto/mcp-tools` catalog. Each exposed tool becomes one `POST /v1/<tool.name with '.' → '/'>` endpoint, and the OpenAPI spec is built from the same list — so REST and MCP cannot diverge. Add a tool → an endpoint and an OpenAPI path appear automatically. (`substrate.kind.define` and other system ops are excluded — admin-gated.)

- `GET /v1/openapi.json` — the generated spec (source of truth).
- `GET /v1/docs` — Redoc UI over the spec.
- `POST /v1/<op>` — invoke an operation; e.g. `POST /v1/entity/create` == the `entity.create` tool.

## Auth & tenancy

`Authorization: Bearer <key>` or `X-API-Key: <key>`. The **tenant + actor are resolved from the key server-side** (never from the request) — invariant 1 / ADR 0037. Keys live in the `api_key` table (sha256-hashed). Mint one:

```bash
DATABASE_URL=... pnpm --filter @exsto/rest-api create-key <tenantId> <actorId> [name]
```

## Cross-cutting

- **Writes** go through the append-only action layer; **reads** are tenant-scoped and bitemporal.
- **Idempotency**: optional `Idempotency-Key` header on writes (in-memory; see CLAUDE.md for the durability caveat).
- **Rate limiting**: per-tenant fixed window; `X-RateLimit-*` headers, `Retry-After` on 429.
- **Errors**: `{ "error": { "code", "message", "details"? } }`.

## Run

```bash
pnpm install && pnpm --filter @exsto/rest-api build
DATABASE_URL=... pnpm --filter @exsto/rest-api start        # PORT=4001 by default
```

## Verify (live)

```bash
pnpm --filter @exsto/rest-api build
DATABASE_URL=... pnpm --filter @exsto/rest-api parity       # REST==core, cross-tenant, guards
pnpm --filter @exsto/rest-api gen:docs                      # regenerate docs/REST_API.md from the spec
```
