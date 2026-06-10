# ADR 0034: Splitting AI action handlers between an API function and a handler

## Status
Accepted

## Context
The `legal.draft.generate` action is the wedge's AI write path: take a matter's questionnaire + transcript, call Claude, persist the draft and its reasoning trace.

Two pieces are non-negotiable:
1. Substrate writes (action, content_blob, entity, attribute, document_version, relationship) must be atomic — they share one transaction (ADR 0031).
2. Every action with `requires_reasoning_trace = true` must have its `reasoning_trace_id` already set when the action is inserted — the action layer rejects it otherwise, and the action log is append-only so we cannot patch it later.

These pull in opposite directions. Atomicity wants everything in one transaction. The reasoning trace must exist *before* the action insert, but the trace itself is the output of a several-second Claude call that we do not want to hold a database connection for.

## Decision

Split `legal.draft.generate` into two phases:

1. **API function** (`verticals/legal/src/api/generateDraft.ts`):
   - Load matter context (questionnaire + transcript) via the query helpers.
   - Render the drafting prompt.
   - Call Claude (no DB connection held during this).
   - In its own short `withActionContext` transaction, insert the `reasoning_trace` row and return the id.
   - Call `submitAction` with `reasoningTraceId` set and the document markdown in the payload.

2. **Action handler** (`verticals/legal/src/handlers/draft.ts`):
   - Receives the live DB client inside the `submitAction` transaction.
   - Writes the content_blob, draft_document entity, document_version, matter→document relationship, and matter_status attribute.

The two-transaction split means the trace can briefly exist without an action pointing at it (if `submitAction` were to fail between trace persistence and action insert). That is a harmless orphan, not a correctness violation: an orphan trace is just an unused reasoning artifact, never a misleading audit claim.

## Consequences

### What this makes easier
- Long-running model calls do not hold a database connection.
- The substrate writes that *do* matter for audit (the action and its effects) remain atomic.
- Other AI-driven action kinds (`legal.engagement_letter.generate`, future drafters) follow the same shape: api function does the model call + trace persistence; handler does the substrate writes.

### What this makes harder
- Orphan reasoning_trace rows are possible. A future audit query may want to flag them. Acceptable for v1.
- Callers of `legal.draft.generate` cannot submit the action manually; they must go through `generateDraft` to get a valid `reasoningTraceId`. The MCP tool wires this correctly, but anyone using the substrate at a lower level needs to know.

## Alternatives considered
- Hold the DB transaction across the Claude call. Rejected: ties up a connection for 10–30 seconds per matter and risks transaction timeouts.
- Make `reasoning_trace.action_id NOT NULL` and create the trace inside the handler. Rejected because then the trace cannot exist before the action, which means `action.reasoning_trace_id` cannot point at it at insert time — and `action` is append-only so we cannot patch it. The current schema makes `reasoning_trace.action_id` columnless (trace has no FK back to action; action points at trace).
- Queue the drafting work to the worker runtime instead of running it inline in the MCP request. Better, but the worker runtime is still a scaffold. Tracked in QUESTIONS.md.

## Accepted
Yes. Pattern is implemented and used by `legal.draft.generate` (operating agreement) and the same handler with `document_kind='engagement_letter'` for engagement letters.
