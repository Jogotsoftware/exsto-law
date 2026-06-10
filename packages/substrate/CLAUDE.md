# The substrate engine

This package enforces the 23 layer 1 invariants. Everything else in the substrate inherits from primitives that obey these invariants because they pass through this package.

## What lives here

- Action layer (the universal write path; every change to substrate state is an action)
- RLS context management (sets app.tenant_id; required at the start of every operation)
- Hybrid logical clock implementation
- Hash chain construction and verification
- Governance gradient evaluation (autonomous, notify, approve, suggest)
- Reasoning trace capture
- Query helpers that respect tenant isolation, knowability state, confidence, provenance
- Read consistency primitives (read-your-writes, monotonic reads, snapshot)

## What does not live here

- Specific entity, attribute, or relationship kinds. These are data, in the definition registries.
- Specific MCP tools. They live in packages/mcp-tools.
- Specific worker handlers. They live in workers/runtime/handlers.
- UI code. Lives in apps/reference.

## Hard rules in this package

1. The action layer is the only write path. There is no internal helper that bypasses it.
2. Every public function accepts a tenant context and a session context. There are no global state writes.
3. Every fact written carries provenance, confidence, knowability, time precision. The function signature requires these explicitly.
