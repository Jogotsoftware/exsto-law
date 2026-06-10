# verticals/legal — legal vertical for Pacheco Law

This package is the Layer 3 wedge: the operating-agreement intake → consultation → drafting → review loop for Pacheco Law Firm.

## Rules

- Every write must flow through `submitAction`. No direct INSERTs from this package.
- Templates are content, not code. Edit `templates/*` files, don't edit string literals in source.
- The Claude adapter is the only place that talks to the Anthropic API. The Granola and Google Calendar adapters are stubs for v1 and must keep the same interface they will have when real; do not let stub-only assumptions leak into callers.
- Reasoning traces are mandatory for any action with `requires_reasoning_trace = true` in the action_kind_definition row (e.g. `legal.draft.generate`). The handler must insert the trace row, then submit the action with `reasoningTraceId` set.
