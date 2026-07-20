---
name: exsto-ai-operation
description: Record an AI-driven action in Exsto correctly — persist a reasoning trace, link it to the action, write only through the action layer, with honest confidence and the right autonomy tier. ALWAYS consult this when an agent (Claude or any LLM) writes to the substrate, when building an AI drafting/inference/judgment flow, when calling the Anthropic SDK, or when an action kind has requires_reasoning_trace = true.
---

# Recording an AI operation

An AI silently writing wrong facts at scale is far harder to clean up than a human's slip, so every AI action must be *accountable*: it goes through the same governed action layer as a human action, plus three additions — a persisted reasoning trace linked to the action, a confidence that reflects real uncertainty (never 1.0), and an autonomy tier matched to the risk (ADR 0020, 0022, 0028). No "internal-only" AI path skips this.

## The real write path (two steps, one actor type)

The AI actor's `actor_type` is `agent` (core seed: actor `00000000-0000-0000-0001-000000000004`, "Claude"). Then:

1. **Persist the reasoning trace first**, into `reasoning_trace` (an append-only table). Columns: `id, tenant_id, agent_actor_id, prompt, evidence, alternatives, conclusion, confidence, model_identity, trace`. Confidence is clamped to `[0,1]`.
2. **Submit the action with the trace id** so the `action` row's `reasoning_trace_id` points at it:

```typescript
const reasoningTraceId = await persistReasoningTrace(ctx, {
  prompt, evidence, alternatives, conclusion,
  confidence: result.reasoningTrace.confidence,   // honest, < 1.0
  modelIdentity: result.modelIdentity, fullTrace: result.reasoningTrace,
});

return submitAction(ctx, {
  actionKindName: 'legal.draft.generate',          // an action kind with requires_reasoning_trace = true
  intentKind: 'enforcement',
  reasoningTraceId,
  payload: { /* ... document_markdown, model_identity, ... */ },
});
```

`verticals/legal/src/api/generateDraft.ts` is the working reference — note `persistReasoningTrace` there is a **local helper in that file** (a parameterized `INSERT INTO reasoning_trace` inside its own `withActionContext` transaction), not an importable `@exsto/*` export; copy the pattern, don't reach for an import that doesn't exist. Reasoning traces are **mandatory** for any action whose `action_kind_definition.requires_reasoning_trace = true`; insert the trace row, then submit with `reasoningTraceId` set — `submitAction` (`packages/substrate/src/action.ts`) throws if the kind requires a trace and none is passed. Note: `legal.draft.generate` is provisioned in the **exsto-wedge** project, not seeded in exsto-dev; for an exsto-dev-testable trace use the seeded `reasoning.capture` action kind.

## Talking to the model

The Anthropic SDK lives behind a single adapter (`verticals/legal/src/adapters/claude.ts`, `callClaudeDrafter`). It uses `@anthropic-ai/sdk` and `ANTHROPIC_API_KEY`; which model runs is decided by the central model router (`verticals/legal/src/lib/modelRouter.ts`, `resolveModelForTask`) — pure policy, no SDK import, the SINGLE home of Claude model ids (`TIER_MODEL`). Every `callClaudeDrafter` call now REQUIRES a `task: AiTask` field (e.g. `'draft_generate'`, `'doc_review'`, `'brief_client'`) so the router can pick Haiku vs Sonnet per task and apply the firm's `LEGAL_DRAFTING_MODEL` override only where it belongs; a new call site that forgets `task` fails `tsc`, not a silent guessed model. Keep model calls in one adapter; record `response.model` as `model_identity` in the trace. Default to the latest capable Claude model for new work (add/adjust an entry in `TIER_MODEL`, not a hardcoded string).

## What the trace must contain (or the feedback loop is blind)

- **evidence** with row refs (`entity:<id>`) — what the agent actually looked at.
- **alternatives_considered** — so the substrate can later ask "it chose Y over X; was Y right?"
- **conclusion** + **confidence** on it — calibration compares predicted confidence to real outcomes.
- **uncertainty / ambiguities** — what the agent itself flagged for review.
- **model_identity** (+ prompt version) — to compare across model upgrades.

## Autonomy tier (gate the risk)

Choose per `(agent, action_kind, tenant)`: `autonomous` for low-risk tags; `notify` for moderate writes (judgment, attribute); `approve` for overriding human values; `suggest` for irreversible/external side effects. Low confidence escalates: `const tier = confidence < 0.7 ? 'approve' : default`.

## Gotchas

- **Confidence 1.0 is a smell.** AI is rarely certain; faked certainty makes calibration impossible.
- **Never write directly.** Even "just a suggestion" goes through `submitAction`. No raw INSERT into substrate tables from a vertical (verticals/legal/CLAUDE.md).
- **The trace is not optional for `requires_reasoning_trace` kinds** — the action is meaningless without the linked trace.
- **`reasoning.capture` action kind** exists for capturing a standalone trace through the generic surface.

## Pointers to ground truth

- `verticals/legal/src/api/generateDraft.ts` (the two-step path) and `src/adapters/claude.ts` (the SDK adapter).
- `docs/patterns/ai-action-handler.md`; `verticals/legal/CLAUDE.md`; ADRs 0020, 0022, 0028.
- Use the `claude-api` skill for SDK specifics (caching, model migration).

## Verify

After an AI operation, the action and its trace must be linked and the trace immutable:

```sql
SELECT a.id, a.reasoning_trace_id, r.model_identity, r.confidence
  FROM action a JOIN reasoning_trace r ON r.id = a.reasoning_trace_id
 WHERE a.id = $1;                       -- one row; confidence in [0,1) and < 1.0 for real inference
```

Attempting `UPDATE reasoning_trace ...` must raise `append-only violation (invariant 14)`. For a `requires_reasoning_trace` kind, an action submitted with a null `reasoning_trace_id` must be rejected/flagged.
