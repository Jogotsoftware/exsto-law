# MCP Server

A spec-compliant Model Context Protocol server for the Exsto substrate, built on the official `@modelcontextprotocol/sdk`. It is a **transport over the operation core** — it exposes the registered `@exsto/mcp-tools` catalog via MCP `tools/list` and `tools/call`, and every call flows through the same action/query core (`packages/substrate` + `packages/primitives`). No business logic lives here.

## Transports

| Transport | When | Principal (tenant + actor) |
|---|---|---|
| **streamable HTTP** (default) | remote clients, multiple callers | `x-tenant-id` / `x-actor-id` request headers (validated UUIDs), bound server-side |
| **stdio** | local clients that launch the server as a subprocess (Claude Desktop, IDEs) | `EXSTO_TENANT_ID` / `EXSTO_ACTOR_ID` env |

The principal is **never** taken from tool arguments, so a client cannot choose its own tenant (invariant 1 / ADR 0037). The DB connection must use the non-owner `authenticated` role.

## Run

```bash
pnpm install
pnpm --filter @exsto/mcp-server build

# streamable HTTP (default) — POST /mcp, health at GET /health
DATABASE_URL=... pnpm --filter @exsto/mcp-server start            # PORT=4000 by default

# stdio
DATABASE_URL=... EXSTO_TENANT_ID=... EXSTO_ACTOR_ID=... \
  MCP_TRANSPORT=stdio node apps/mcp-server/dist/index.js
```

### Connect from a client

Streamable HTTP (SDK client):

```ts
const transport = new StreamableHTTPClientTransport(new URL('http://localhost:4000/mcp'), {
  requestInit: { headers: { 'x-tenant-id': TENANT, 'x-actor-id': ACTOR } },
});
await client.connect(transport);
await client.listTools();
await client.callTool({ name: 'substrate.capability.list', arguments: {} });
```

stdio (e.g. an MCP client config): launch `node apps/mcp-server/dist/index.js` with
`MCP_TRANSPORT=stdio`, `EXSTO_TENANT_ID`, `EXSTO_ACTOR_ID`, `DATABASE_URL` in `env`.

## End-to-end smoke test

`scripts/smoke.mjs` drives the built server with a real SDK client over **both** transports (tools/list + tools/call against live data) and asserts a missing-principal HTTP request is rejected with 401:

```bash
pnpm --filter @exsto/mcp-server build
DATABASE_URL=... pnpm --filter @exsto/mcp-server smoke
```
