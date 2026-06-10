# ADR 0024: MCP is the primary client-facing interface

## Status
Accepted — amended by ADR 0038. The invariant below stands: no client touches the substrate directly, and there is one enforcement path. What changed: a REST/OpenAPI surface is now permitted as a **sibling adapter over the shared operation core** (not rejected). Read the "Decision" section with that amendment in mind.

## Context
The substrate needs an interface for clients (UIs, agents, integrations) to read and write data. Standard options are REST APIs, GraphQL, and direct database access. Each has tradeoffs.

REST is universally supported but requires authoring per-endpoint code for every operation. As the substrate grows, the API surface grows in lockstep.

GraphQL solves the per-endpoint problem but adds a query layer that needs to be maintained, secured, and tuned for performance.

Direct database access via Postgres clients works for trusted internal code but doesn't translate to AI agents, third-party integrations, or untrusted clients.

The Model Context Protocol (MCP) is purpose-built for AI agent and tool integration. It provides a structured way to expose capabilities (tools, resources, prompts) to clients, with schema-aware tool definitions, structured request and response formats, and built-in support for authentication.

For Exsto, where AI agents are first-class clients of the substrate, MCP is the natural fit. Adopting it as the primary interface (not just an AI-specific layer) means every client (UI, agent, integration) goes through the same path.

## Decision
The MCP server is the canonical client-facing interface to the substrate.

UIs use MCP. Agents use MCP. Integrations use MCP. There is no parallel REST or GraphQL layer. _(Amended by ADR 0038: a REST/OpenAPI **adapter** over the same operation core is permitted — MCP stays primary, and what remains forbidden is a parallel layer that runs its own SQL against the substrate.)_

Implementation:
- `apps/mcp-server` runs the MCP server, supporting both stdio (for local Claude Code development) and HTTP transports (for production clients).
- `packages/mcp-tools` holds individual tool implementations. Each tool is a single file.
- New substrate operations become new MCP tools. The pattern (`docs/patterns/mcp-tool.md`) is followed uniformly.
- Authentication uses tenant-scoped tokens. Every MCP request sets `app.tenant_id` from the token before any database operation.

Direct database access is reserved for:
- The action layer in `packages/substrate` (which the MCP server's tools call into)
- Worker handlers in `workers/runtime/handlers` (which run server-side and need direct access for performance and transaction control)
- Migration scripts

Application code (UI, internal admin, anything user-facing) goes through MCP, not direct database access.

## Consequences

What's now easier:
- AI agent integration. Native MCP support. No translation layer.
- Capability discovery. MCP exposes a tool catalog that clients can introspect.
- Auth and tenancy. One enforcement path.
- New clients. A future mobile app, CLI, or third-party agent uses the same interface UIs use.

What's now harder:
- MCP is newer than REST or GraphQL. Tooling and ecosystem are still maturing. Some standard libraries (auth, rate limiting, observability) need adapting.
- Performance characteristics differ. MCP's request and response model is structured. Bulk operations need careful tool design.
- Web UI integration with MCP requires an HTTP transport plus client-side calls; the SDK and patterns are still settling.

## Alternatives considered

**REST API as primary interface, MCP as adapter.** Rejected: doubles the surface area. The substrate's interface is one thing, not two.

**GraphQL as primary.** Considered. Strong introspection. The team's familiarity with MCP and the alignment with AI agent use cases tipped the decision.

**Direct database access for trusted clients, MCP for agents.** Rejected: produces two security models, two access patterns, two debugging stories.

**Build custom protocol.** Rejected: reinventing the wheel. MCP solves the same problem and has a growing ecosystem.
