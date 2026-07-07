# verticals/legal — legal vertical for Pacheco Law

This package is the Layer 3 wedge: the operating-agreement intake → consultation → drafting → review loop for Pacheco Law Firm.

## Rules

- Every write must flow through `submitAction`. No direct INSERTs from this package.
- Templates are content, not code. Edit `templates/*` files, don't edit string literals in source.
- The Claude adapter is the only place that talks to the Anthropic API. The Granola and Google Calendar adapters are live (Granola via per-attorney OAuth/MCP in `adapters/granola.ts` → `granolaMcp.ts`; Google Calendar via `googleapis` in `adapters/googleCalendar.ts`); keep their interface stable so callers stay adapter-agnostic.
- Reasoning traces are mandatory for any action with `requires_reasoning_trace = true` in the action_kind_definition row (e.g. `legal.draft.generate`). The handler must insert the trace row, then submit the action with `reasoningTraceId` set.
