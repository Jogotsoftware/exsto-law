# MCP server package

This package contains the MCP server process. Built on the official `@modelcontextprotocol/sdk`, it exposes the registered tools over two spec-compliant transports — **stdio** and **streamable HTTP** (JSON-RPC) — and routes `tools/list` / `tools/call` to the `@exsto/mcp-tools` registry.

## Rules

- The server is a transport boundary only. The principal (tenant + actor) is bound from the transport — env for stdio, validated `x-tenant-id`/`x-actor-id` headers for HTTP — and never from tool arguments.
- No business logic is implemented in the server other than request parsing, transport, and context setup.
- All domain work belongs in packages/mcp-tools, packages/substrate, or packages/primitives.
- `src/server.ts` builds the SDK `Server` bound to one principal; `src/http.ts` and `src/stdio.ts` are the two transports; `src/index.ts` selects one via `MCP_TRANSPORT`. Verify changes with `scripts/smoke.mjs` (real SDK client over both transports).
