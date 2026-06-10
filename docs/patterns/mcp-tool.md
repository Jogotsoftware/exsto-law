# Pattern: MCP Tool

## When to use this pattern

Anytime you want a substrate capability accessible to clients (UIs, agents, integrations). The MCP server is the canonical interface (ADR 0024); new capabilities are new MCP tools.

If you find yourself building a custom REST endpoint, an internal helper that does substrate operations, or a "just for the UI" function that bypasses MCP, stop. You want an MCP tool.

## The shape

Tools are registered with `registerTool` from `packages/mcp-tools/src/tool.ts`. The generic substrate tools live together in `packages/mcp-tools/src/tools/substrateTools.ts`; a vertical may add its own tool file. A tool is an object:

```typescript
interface Tool<Input, Output> {
  name: string;                  // domain.verb.qualifier
  description: string;
  mode: 'read' | 'write';
  handler: (ctx: ActionContext, input: Input) => Promise<Output>;
}
```

`registerTool(tool)` adds it to the catalog; `getTools()` is what the MCP server serves. There is no separate `inputSchema` field in the registration — the handler types its own `input` and validates it.

## Read tool example

Read tools call a query helper from `@exsto/primitives` (which runs under the tenant-scoped `ctx`, so RLS is engaged) and return structured data.

```typescript
// packages/mcp-tools/src/tools/substrateTools.ts
import { registerTool } from '../tool.js';
import { listEntitiesByKind } from '@exsto/primitives';

registerTool({
  name: 'entity.list_by_kind',
  description: 'List active entities of a given kind.',
  mode: 'read',
  handler: (ctx, input: { entityKindName: string; limit?: number }) =>
    listEntitiesByKind(ctx, input.entityKindName, input.limit ?? 100),
});
```

## Write tool example

Write tools call an action-layer primitive (which routes through `submitAction`); they never write directly.

```typescript
import { registerTool } from '../tool.js';
import { recordJudgment } from '@exsto/primitives';

registerTool({
  name: 'judgment.record',
  description: 'Record a judgment (qualitative assessment) about an entity.',
  mode: 'write',
  handler: (ctx, input: {
    subjectEntityId: string;
    judgmentKindName: string;
    value: unknown;
    confidence: number;
    reasoningTraceId?: string;            // required path when the actor is an agent
    polarity?: 'positive' | 'negative';
  }) => recordJudgment(ctx, input),
});
```

The tool is dispatch and validation; `recordJudgment` builds the action and `submitAction` does the writing. When the actor is an agent, the judgment needs a `reasoningTraceId` — `submitAction` throws if the action kind has `requires_reasoning_trace = true` and none is supplied (see `ai-action-handler.md`). For action kinds with no dedicated primitive (governance, structural, communication, ingestion, ...), use the generic `substrate.action.submit` tool, which calls `submitPrimitiveAction(ctx, { actionKindName, payload, intentKind })`.

## Tool naming and granularity

Names follow `domain.verb.qualifier`:

- `entity.list_by_kind`
- `entity.get`
- `attribute.history.get`
- `judgment.record`
- `workflow.advance`

Each tool does one thing. Don't write a tool that "lists or gets" or "creates or updates." Two tools.

## Customization points

When writing a new tool:

1. **Pick the name.** Match an existing pattern (`domain.verb.qualifier`).
2. **Set `mode`.** `'read'` or `'write'` — this is how clients and the server reason about the tool.
3. **Type and validate the input.** The handler's `input` parameter is typed inline; reject malformed input with a clear error before any effect.
4. **Decide read or write.** Reads call query helpers (`@exsto/primitives` queries / `executeQuery`); writes call action-layer primitives (`createEntity`, `setAttribute`, `recordJudgment`, `submitPrimitiveAction`, ...).
5. **Return structured output**, not strings.
6. **Register it** with `registerTool`, and test it (happy path, validation error, tenancy isolation).

## Common mistakes

**Bypassing the action layer in a write tool.** A write handler that runs `client.query("INSERT ...")` is a bug. Always call an action-layer primitive.

**Returning unstructured strings.** MCP clients are programs (and agents). They consume structured data. A tool returning `"Found 5 entities"` is much less useful than one returning `{ count: 5, entities: [...] }`.

**Skipping input validation.** Every tool validates its input in the handler and rejects bad input with a clear error.

**Putting business logic in the tool.** The tool is dispatch and validation. Business logic lives in `packages/primitives` or `packages/substrate`.

**Forgetting it needs registering.** A tool object that is never `registerTool`'d is invisible — `getTools()` (what the server serves) won't include it.

**Assuming the handler must set tenancy.** The MCP server sets `app.tenant_id` per request before dispatch; the query/primitive helpers run under `ctx`. Don't open your own un-scoped DB connection inside a tool.

## Related ADRs and patterns

- ADR 0024: MCP as primary interface
- ADR 0001: Tenancy enforced at the database layer
- Pattern: `action-handler.md` (write tools call action handlers)
- Pattern: `ai-action-handler.md` (write tools that need to handle AI actors)
- Skill: `exsto-mcp-tool` (the verified authoring guide), `exsto-mcp-spec` (the server runtime)
