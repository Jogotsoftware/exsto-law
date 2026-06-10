# ADR 0038: One operation core; MCP and REST are sibling adapters

## Status
Accepted. Amends ADR 0024 (MCP as primary client-facing interface).

## Context
ADR 0024 made MCP the canonical client interface and explicitly rejected "any parallel REST or GraphQL layer." That framing conflated two different things:

1. The **architectural invariant** — *no client touches the substrate tables directly.* Every client goes through the shared core where tenancy, append-only, provenance, and reasoning capture are enforced.
2. The **wire protocol** that core is exposed over.

The invariant is non-negotiable. The protocol is not. Real adopters — partners, external tools, and clients that cannot speak MCP — need a REST/OpenAPI surface. Forbidding REST outright pushes integrators toward the one thing the architecture must never allow: direct database access, or a bespoke server running its own SQL against the substrate.

## Decision
There is one **operation core**: the action layer (`packages/substrate` — `submitAction`, `executeQuery`, `withActionContext`) plus the primitive facades (`packages/primitives` — `createEntity`, `setAttribute`, `recordJudgment`, …). Every client reaches the substrate only through that core.

MCP and REST are **sibling adapters over the core — not two doors to the database:**

- The **MCP adapter** (`apps/mcp-server` + `packages/mcp-tools`) is the primary/default adapter.
- A **REST/OpenAPI adapter** is permitted **only** as a thin translation layer that:
  - authenticates the caller and **derives the tenant from the authenticated principal**, never from a request body/query field;
  - **delegates to the exact same operation** a sibling MCP tool would call (`submitAction` for writes, the query helpers for reads);
  - runs DB access as `authenticated` with `app.tenant_id` bound — never `service_role`;
  - obeys the bitemporal read rules and stays append-only (corrections are new versions/events, never an UPDATE/DELETE on history).

Direct database access remains reserved for the action layer, worker handlers (`workers/runtime`), and migration scripts.

## Consequences

**Easier**
- Partner/external integration without forcing MCP on the client.
- One enforcement path (tenancy, append-only, provenance, reasoning) regardless of protocol.

**Harder**
- Two adapters must be kept from drifting. Generate the OpenAPI spec from the same action/tool definitions; a REST write must produce the *same* `action` row and the *same* tenant-scoped effects as the equivalent MCP call.
- Cross-cutting REST concerns (versioning, pagination, idempotency keys on writes, rate limiting, consistent error shapes) must be added without leaking into the core.

**The cardinal regression to guard against:** a REST handler that becomes a *parallel CRUD layer* issuing raw SQL against `entity` / `attribute` / `event` / `relationship` / …. That is exactly what ADR 0024 was really protecting against, and it stays forbidden. A handler writing its own substrate SQL has stopped being an adapter.

## Alternatives considered

**Keep MCP-only (status quo, ADR 0024).** Rejected: blocks legitimate REST clients and tempts them into direct DB access — the worse outcome.

**REST as primary, MCP as adapter.** Still rejected (as in ADR 0024): MCP stays primary because AI agents are first-class clients. REST is the *sibling*, not the lead.

**REST as a parallel CRUD layer with its own SQL.** Rejected: the cardinal violation; defeats every enforcement the core exists to provide.

**Two cores, one per protocol.** Rejected: doubles the surface and guarantees the two drift.

## Pointers
- `ARCHITECTURE.md` (operation-core framing), `CLAUDE.md` hard rule 9.
- Skills: `exsto-mcp-tool` (MCP adapter), `exsto-rest-api` (REST adapter), both over the same core.
- Supersedes the "no parallel REST or GraphQL layer" sentence in ADR 0024.
