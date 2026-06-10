---
name: exsto-mcp-spec
description: How the Exsto MCP server runtime works — transports, tool dispatch, per-request tenant context — and how it relates to the Model Context Protocol. ALWAYS consult this when running/debugging apps/mcp-server, wiring a client (Claude Code, a UI, an agent) to the substrate, adding transport/auth, or reasoning about how registered tools are exposed. (To AUTHOR a tool, use exsto-mcp-tool.)
---

# The Exsto MCP server

The MCP server (`apps/mcp-server`) is the **primary adapter over the one operation core** (ADR 0024, ADR 0038) — the default way clients reach the substrate. Everything — the demo app, Claude Code in development, future agents and integrations — goes through it; a REST/OpenAPI adapter (exsto-rest-api) is the permitted *sibling* over the same core. The server's only jobs are **transport, auth/tenant binding, dispatch, and lifecycle**; it holds no business logic (that lives in `packages/mcp-tools` → primitives → the action layer). Keeping the server thin is what keeps every client on the one enforced path.

## What the server does (and only this)

1. **Transport** — today a plain HTTP server (`src/index.ts` + `src/mcp.ts`): `GET /health`, `GET /tools`, and `POST /mcp` with a JSON body `{ toolName, input, tenantId, actorId }`, default port `4000`. (A stdio / full MCP-protocol transport is not yet implemented — don't assume one.)
2. **Auth + tenant token validation** — resolves the caller's tenant and actor.
3. **Set `app.tenant_id` before any DB op** — every request, no exceptions. Agent-invoked calls capture a `reasoning_trace`.
4. **Dispatch** — serves the catalog from `getTools()` (`packages/mcp-tools/src/tool.ts`) and routes a call to the matching tool's handler `(ctx, input)`.
5. **Lifecycle** — telemetry, structured errors, response shaping.

Run it: `pnpm dev:mcp` (= `pnpm --filter @exsto/mcp-server start`). A tool only becomes visible to clients if it was `registerTool`'d and thus returned by `getTools()`.

## How it maps to the MCP standard

Exsto tools are shaped like Model Context Protocol *tools* — name, description, input, structured result — but the current server speaks a **bespoke HTTP/JSON shape, not JSON-RPC**: discovery is `GET /tools` (backed by `getTools()`), invocation is `POST /mcp` routed to the matching handler. Adopting the wire-level MCP protocol (`tools/list`, `tools/call`, capability/transport handshakes) is future work; until then treat the standard as the design north star, not the current transport. Exsto adds substrate semantics on top: `mode: 'read'|'write'`, mandatory tenant context, and audit via the action layer. For protocol-level details consult the MCP specification at modelcontextprotocol.io; for *building* an Exsto tool, use **exsto-mcp-tool**.

## Gotchas

- **No business logic in the server.** If you're tempted to add a query or write here, it belongs in a tool (`packages/mcp-tools`). The server dispatches; it does not implement.
- **No bypass clients.** A UI/agent that talks to Postgres directly, or a REST route that runs its own substrate SQL, breaks the operation-core rule (ADR 0024, ADR 0038). Clients go through an adapter; the adapter goes through the core.
- **Tenant context is the server's responsibility per request** — a tool handler assumes `app.tenant_id` is already set; the server must set it before dispatch.
- **Transport reality:** every client (Claude Code, the demo app, agents) currently uses the one HTTP transport; there is no stdio path yet. Same `getTools()` catalog regardless.

## Pointers to ground truth

- `apps/mcp-server/CLAUDE.md`, `apps/mcp-server/src/index.ts` + `src/mcp.ts`, `apps/mcp-server/README.md`.
- `packages/mcp-tools/src/tool.ts` (`getTools`/`registerTool`); ADR 0024, ADR 0038; exsto-mcp-tool; exsto-rest-api (REST sibling adapter); exsto-ai-operation.

## Verify

The server exposes the substrate correctly: start it (`pnpm dev:mcp`), then `GET /tools` lists the registered tools and `POST /mcp { toolName, input, tenantId, actorId }` runs one; a read tool succeeds only with a valid tenant context, and a call missing `tenantId`/`actorId` is rejected (`400`). Every agent-invoked write leaves a `reasoning_trace` row linked to its action.