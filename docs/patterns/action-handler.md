# Pattern: Action Handler

## When to use this pattern

Anytime you write to the substrate. Action handlers are the only legitimate write path. Direct INSERT/UPDATE/DELETE on substrate tables is forbidden in application code (see ADR 0009).

If you are about to write a function that calls `db.query("INSERT INTO entity ...")`, stop. You want an action handler.

## The shape

An action handler is a function that:

1. Constructs an `action` row capturing actor, intent, autonomy tier, and reasoning
2. Submits it to the action layer in `packages/substrate`
3. The action layer evaluates governance, runs the effects (the actual writes), and records the action plus its effects
4. Returns the action result to the caller

## Working example

```typescript
// packages/primitives/src/attribute.ts

import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate';
import type { IntentKind } from '@exsto/shared';

export interface CreateAttributeInput {
  entityId: string;
  attributeKindName: string;
  value: unknown;
  confidence: number;
  knowabilityState: string;   // observed | observed_null | never_observed | withheld | ...
  timePrecision: string;      // exact_instant | second | ... | unknown
  intentKind: IntentKind;     // correction | reflection | adjustment | override | exploration | enforcement | automatic_sync | unknown
  reasoningTraceId?: string;
}

export async function setAttribute(
  ctx: ActionContext,
  input: CreateAttributeInput
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'attribute.set',
    intentKind: input.intentKind,
    reasoningTraceId: input.reasoningTraceId,
    payload: {
      entity_id: input.entityId,
      attribute_kind_name: input.attributeKindName,
      value: input.value,
      confidence: input.confidence,
      knowability_state: input.knowabilityState,
      time_precision: input.timePrecision,
    },
  });
}
```

The handler is small. It does not write to the database directly. It calls `submitAction` (from `@exsto/substrate`), whose input is `{ actionKindName, intentKind, autonomyTier?, targetKind?, targetId?, payload, reasoningTraceId? }`. The action layer then, inside one transaction (`withActionContext` → `withTenant`):

- Sets `app.tenant_id` (and `app.actor_id`) from `ctx`
- Looks up the active `action_kind_definition` for `actionKindName` (errors if the kind doesn't exist)
- Enforces `requires_reasoning_trace`: if the kind requires one and `reasoningTraceId` is absent, it **throws**
- Resolves the autonomy tier (`input.autonomyTier ?? kind.default_autonomy_tier`), generates the HLC, and inserts the `action` row
- Runs the registered effect handler for `attribute.set` **on the same DB client**, so the action and its effects commit atomically (the `attribute.set` handler closes the prior open value — `UPDATE attribute SET valid_to = now() WHERE ... valid_to IS NULL` — then inserts the new `attribute` row)
- Returns `{ actionId, effects }`

## What the action layer does for you

You don't have to remember to:
- Set tenancy (the action layer sets `app.tenant_id`)
- Capture the actor (it's in `ctx`)
- Record provenance (taken from `ctx.actor`)
- Track time (HLC and recorded_at are set automatically)
- Append to the action log (every action becomes a row)
- Trigger downstream events (the action layer fires events and triggers based on `action_kind_definition`)

You do have to:
- Provide the input completely
- Choose the right `intentKind`
- Provide a `reasoningTraceId` when the action kind has `requires_reasoning_trace = true` (typically AI actions)
- Handle the result (`{ actionId, effects }`)

## Customization points

When writing a new action handler:

1. **Pick the `actionKindName`.** It must exist as an active `action_kind_definition` row for the tenant. If it doesn't, that's a separate decision (and probably a definition row insertion, not a code addition — see exsto-add-kind).
2. **Define the input shape.** Required fields, optional fields, types.
3. **Map input to the action's payload.** The action layer handles the storage; you describe what should happen.
4. **Decide what the handler returns.** Most handlers return `ActionResult`. Specialized handlers may wrap with domain-specific types.

## Common mistakes

**Writing to substrate tables directly.** The action layer is mandatory. If you need to do something the action layer doesn't expose, that's a substrate change, not a workaround.

**Forgetting to provide `reasoningTraceId` for trace-required kinds.** AI action kinds set `requires_reasoning_trace = true` (ADR 0020). `submitAction` does not warn — it **throws** (`Action kind <name> requires a reasoning trace.`) if the kind requires one and `reasoningTraceId` is missing. Persist the trace first, then submit with its id (see ai-action-handler.md).

**Hardcoding `intentKind`.** The intent depends on the situation. A function parameterized by `intentKind` is usually right.

**Bypassing for "performance."** The action layer is fast (a single insert plus the effects). If profiling shows it's a bottleneck, the answer is to optimize the action layer, not bypass it.

## Related ADRs and patterns

- ADR 0009: Auditability via the action layer
- ADR 0010: Intent on every action
- ADR 0022: Governance gradients
- Pattern: `mcp-tool.md` (MCP tools that need to write call action handlers)
- Pattern: `ai-action-handler.md` (specialized variant for AI-originated actions)
