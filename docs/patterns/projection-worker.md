# Pattern: Projection Worker

> ⚠️ **Unverified against current code.** The worker runtime is not present under `workers/` on this branch, so the helper names below (`registerHandler`, `WorkerJob`, `WorkerContext`, `fetchRawEvent`, `fetchEntityKindDefinitionVersion`) are illustrative and have **not** been confirmed against real exports. Verify against the actual worker runtime before copying. Note also that action submission uses the real shape `submitAction(ctx, { actionKindName, intentKind, payload, reasoningTraceId? })` (camelCase) — see `action-handler.md`. The *determinism rules* below are correct and binding regardless.

## When to use this pattern

Anytime raw events need to be transformed into normalized substrate state. Examples:

- A webhook arrives with raw payload; a projection extracts entities, attributes, and relationships
- A bulk import drops events; a projection processes them into the substrate model
- A re-projection rebuilds current state after a projection logic fix

If you find yourself writing code that reads from `raw_event_log` and writes to substrate tables, you want a projection worker.

## What makes a projection different from any other write

Two things:

1. **Determinism.** Given the same inputs and the same definition versions, a projection produces the same output every time (ADR 0013). This is what makes re-projection safe.
2. **Bound to historical configuration.** Projections from old events use the definition versions current when those events were originally processed (ADR 0017).

## The shape

A projection is a handler registered with the worker runtime:

```typescript
// workers/runtime/handlers/projection.entity_create.ts

import {
  registerHandler,
  type WorkerJob,
  type WorkerContext,
} from '@exsto/substrate';
import { setAttribute } from '@exsto/primitives';
import {
  fetchRawEvent,
  fetchEntityKindDefinitionVersion,
} from '@exsto/substrate';

interface EntityCreateProjectionPayload {
  raw_event_id: string;
}

registerHandler<EntityCreateProjectionPayload>({
  job_kind: 'projection.entity.create',

  // The handler runs deterministically against historical config
  async handle(ctx: WorkerContext, job: WorkerJob<EntityCreateProjectionPayload>) {
    // 1. Fetch the raw event
    const event = await fetchRawEvent(ctx, job.payload.raw_event_id);

    // 2. Fetch the definition version current when this event was recorded
    const entityKindDef = await fetchEntityKindDefinitionVersion(ctx, {
      kind_name: event.payload.entity_kind,
      as_of: event.recorded_at,
    });

    // 3. Build a deterministic action context for the projection
    const projectionCtx = {
      ...ctx,
      actor: { type: 'system' as const, reason: 'projection.entity.create' },
      session_hlc: event.hlc,
    };

    // 4. Apply the effects via action handlers
    for (const attr of event.payload.attributes) {
      const attrDef = entityKindDef.attributes.find(a => a.name === attr.name);
      if (!attrDef) {
        // Attribute not in this definition version: log and skip, do not invent
        ctx.logger.warn('attribute_not_in_definition_version', {
          event_id: event.id,
          attribute_name: attr.name,
          definition_version: entityKindDef.version_id,
        });
        continue;
      }

      await setAttribute(projectionCtx, {
        entity_id: event.payload.entity_id,
        attribute_kind_id: attrDef.id,
        value: attr.value,
        confidence: attr.confidence,
        knowability_state: attr.knowability_state,
        valid_from: attr.valid_from,
        valid_to: attr.valid_to,
        time_precision: attr.time_precision,
        intent_kind: 'automatic_sync',
      });
    }
  },

  // Idempotency: re-running the same projection produces the same result
  idempotency_key: (job) => `projection.entity.create:${job.payload.raw_event_id}`,
});
```

## Determinism rules to follow

1. **No `now()`. No `Date.now()`.** Use the event's `occurred_at` and `recorded_at`. The system clock is non-deterministic across re-runs.
2. **No external API calls.** If you need data from outside the substrate, that data must be in the raw event payload or in another substrate row. If it isn't, the ingestion adapter (not the projection) needs to fetch it.
3. **No random numbers.** If randomness is required, seed it from the event's HLC.
4. **Read definition versions explicitly.** Don't read "current" definitions; read the version that was current when the event was recorded.
5. **Order events by HLC.** When projecting multiple events that affect the same target, process in HLC order.

## How re-projection works

To rebuild a projection after a logic fix:

1. Mark the old projection results as superseded (in a separate column; do not delete).
2. Run the projection handler against the affected raw events again.
3. Compare new results to old. The substrate provides a `re_projection.compare` tool that diffs.
4. If the new results are correct, mark them as live and the old as superseded.

This works because the projection is deterministic: re-running on the same inputs with the same definition versions produces the same output. Any difference is the bug fix.

## Customization points

When writing a new projection:

1. **Identify the source events.** What raw event kind triggers this projection?
2. **Identify the target state.** What entity attributes, relationships, or facts does this projection produce?
3. **Define the deterministic mapping.** Pure function of (event payload, definition version).
4. **Register the handler.** With a clear `job_kind` and `idempotency_key`.

## Common mistakes

**Calling `now()`.** The most common mistake. Re-projection produces different results because time has passed. Use the event's recorded time.

**Assuming current definition versions.** A projection that reads `entity_kind_definition` without an `as_of` clause gets current versions, not historical ones. Re-projection of old events produces wrong results.

**Inventing data.** A projection that fills in defaults for missing fields is non-deterministic across schema changes. Log and skip; do not invent.

**Side effects outside the substrate.** A projection that sends an email is not a projection. It's a side-effecting handler. Projections only update substrate state.

**Non-idempotent handlers.** A projection that creates a new row every run (instead of upserting against an idempotency key) produces duplicates on re-projection. Use idempotency keys.

## Related ADRs and patterns

- ADR 0013: Projection determinism
- ADR 0014: Append-only event tables
- ADR 0015: Hybrid logical clocks
- ADR 0017: Configuration version binding
- Pattern: `action-handler.md` (projections write through action handlers)
