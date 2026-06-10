---
name: exsto-mcp-tool
description: Build a new capability as an MCP tool over the substrate primitives — the primary adapter over the one operation core (ADR 0024, ADR 0038). ALWAYS consult this when adding a tool to packages/mcp-tools, when a UI/agent/integration needs a substrate operation, or when tempted to add a REST endpoint that runs its own substrate SQL, a "just for the UI" DB helper, or a direct DB call in app code. (To expose the same core over REST as a sibling adapter, see exsto-rest-api.)
---

# Authoring an MCP tool

MCP is the **primary adapter over the one operation core** — the action/query layer every client reaches the substrate through (ADR 0024, ADR 0038). A new capability is a new MCP tool — never a direct DB call from app code, and never a REST route that runs its own substrate SQL. (REST is allowed, but only as a *sibling adapter* that delegates to the same primitives — see exsto-rest-api.) Tools are thin dispatch: validate input, then a **read** tool calls a query helper and a **write** tool calls an action-layer primitive. Business logic and writes live below the tool, in `@exsto/primitives` / `@exsto/substrate`. Keeping this line bright is what guarantees every operation is tenant-scoped, audited, and governed.

## The real registration shape

Register with `registerTool` from `packages/mcp-tools/src/tool.ts`. The interface is `{ name, description, mode, handler }` where `mode` is `'read' | 'write'` and `handler` is `(ctx: ActionContext, input) => Promise<output>`.

> The pattern lives in `docs/patterns/mcp-tool.md`; the real `registerTool` shape — no separate `inputSchema` field, the handler types and validates its own `input` — is shown here and in `substrateTools.ts`.

```typescript
// Read tool — calls a query helper, returns structured data
registerTool({
  name: 'entity.list_by_kind',
  description: 'List active entities of a given kind.',
  mode: 'read',
  handler: (ctx, input: { entityKindName: string; limit?: number }) =>
    listEntitiesByKind(ctx, input.entityKindName, input.limit ?? 100),
});

// Write tool — calls a primitive that routes through submitAction; never writes directly
registerTool({
  name: 'attribute.set',
  description: 'Set an entity attribute, closing the prior value of the same kind.',
  mode: 'write',
  handler: (ctx, input: { entityId: string; attributeKindName: string; value: unknown;
                          confidence: number; knowabilityState: string; timePrecision: string;
                          intentKind?: IntentKind }) =>
    setAttribute(ctx, { ...input, intentKind: input.intentKind ?? 'adjustment' }),
});
```

## Rules

- **Naming: `domain.verb.qualifier`** — `entity.list_by_kind`, `attribute.history.get`, `judgment.record`. One tool does one thing; "list or get" is two tools, "create or update" is two tools.
- **Reads call queries; writes call primitives.** A write handler that runs `client.query('INSERT ...')` is a bug — call the primitive (`createEntity`, `setAttribute`, `recordJudgment`, `submitPrimitiveAction`, ...), which goes through `submitAction` (governance, audit, HLC, provenance handled for you).
- **Return structured objects, not strings.** Clients are programs and agents: `{ count, entities }`, not `"Found 5"`.
- **Validate input** and reject bad input with a clear error before any effect.
- **Prefer the generic surface for new kinds.** A brand-new kind usually needs no new tool — `substrate.action.submit`, `entity.create`, `entity.context` already cover it. Add a bespoke tool only for a real, repeated query pattern.

## Gotchas

- **No internal bypass.** There is no "internal-only" path that skips MCP/the action layer — agents, user-facing worker ops, and the reference app all go through tools.
- **AI write tools still need a reasoning trace.** If the action kind has `requires_reasoning_trace = true`, the handler must produce/pass a `reasoningTraceId` — see exsto-ai-operation.
- **Register it.** A defined-but-unregistered tool is invisible; `getTools()` is what the server serves.

## Pointers to ground truth

- `packages/mcp-tools/src/tool.ts` (the `Tool` interface + `registerTool`/`getTools`) and `src/tools/substrateTools.ts` (22 generic substrate tools to copy).
- `packages/mcp-tools/CLAUDE.md`; ADR 0024, ADR 0038; exsto-rest-api (the REST sibling adapter); exsto-mcp-spec (the server runtime).
- exsto-ai-operation (AI write tools); exsto-query-substrate (read shapes).

## Verify

The new tool is served and routes correctly:

```
substrate.capability.list           # sanity: server is up
<your.tool> { ...valid input }      # returns structured output
<your.tool> { ...invalid input }    # clear validation error, no partial write
```

For a write tool, confirm exactly one `action` row is appended per call (every write is one action):

```sql
SELECT count(*) FROM action
 WHERE action_kind_id = (SELECT id FROM action_kind_definition WHERE kind_name = '<kind>');
```

And confirm the tool file has no direct INSERT/UPDATE: `git grep -nE 'INSERT|UPDATE' packages/mcp-tools/src/<file>` is empty.
