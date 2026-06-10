# REST / OpenAPI adapter

A sibling adapter to the MCP server over the **same operation core** (ADR 0038, skill `exsto-rest-api`). The cardinal rule: a REST handler authenticates, derives the tenant from the principal, then delegates to the same core operation an MCP tool would call. It must **never** issue its own SQL against substrate tables, and **never** take the tenant from the request.

## Layout
- `src/catalog.ts` — the exposed tool set + `entity.create` ↔ `entity/create` path mapping. The REST surface is generated from `@exsto/mcp-tools` `getTools()`.
- `src/openapi.ts` — `buildOpenApiSpec()`: OpenAPI 3.1 generated from the catalog. The ONE source of truth; docs and `/v1/openapi.json` both come from it. Never hand-write per-endpoint specs.
- `src/auth.ts` — API-key → principal. The ONLY SQL in this package lives here, and only against `api_key` (auth infra), never a substrate primitive table.
- `src/server.ts` — request flow: auth → rate limit → idempotency → `findTool(name).handler(ctx, input)` → envelope. No SQL.
- `src/{idempotency,ratelimit,errors}.ts` — cross-cutting concerns kept out of the core.

## Rules
- New endpoints come from new tools, not new routes. Don't add bespoke routes that bypass the catalog.
- Reads are tenant-scoped/bitemporal; writes go through actions (append-only). Corrections are new versions, never UPDATE/DELETE on history.
- `substrate.kind.define` and other system/admin ops stay excluded from the public surface (`SYSTEM_TOOLS`).

## Verify
`pnpm --filter @exsto/rest-api parity` (REST write == equivalent core call; cross-tenant blocked; auth/system guards). `git grep -nE 'INSERT|UPDATE|DELETE' apps/rest-api/src` must show only `api_key` in `auth.ts`.

## Known follow-ups (flagged)
- Idempotency + rate-limit stores are **in-memory** (per-process); production needs a durable/shared store.
- The auth lookup uses a privileged `withSuperuser` read of `api_key`; production should use a dedicated auth role / SECURITY DEFINER fn and run operations as the non-owner `authenticated` role.
- Per-tool JSON schemas are not yet attached (inputs advertised as a permissive object); attaching them would enrich validation + the OpenAPI.
