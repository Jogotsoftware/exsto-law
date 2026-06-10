# Pattern: AI Action Handler

## When to use this pattern

Anytime an AI agent (Claude or any other LLM) takes an action against the substrate. Examples:

- An agent suggests a tag for an entity
- An agent answers a chat query and the answer becomes a judgment
- An agent infers a relationship between two entities
- An agent drafts a document recorded as the basis for a later workflow

This is a specialization of the action handler pattern. The standard pattern still applies; this adds the AI-specific requirements.

## What's special about AI actions

Three things differ from a human action:

1. **Reasoning trace is required.** ADR 0020 mandates that agent actions capture reasoning. Action kinds for AI work set `requires_reasoning_trace = true`, and `submitAction` **throws** if the trace id is missing.
2. **Confidence is not 1.0.** AI inferences are not certain. Confidence comes from the agent and reflects its actual uncertainty.
3. **Autonomy tier matters more.** A human accidentally taking a wrong action is recoverable through feedback. An AI agent silently writing wrong facts at scale is harder to clean up. The autonomy tier (autonomous, notify, approve, suggest) gates how much oversight the action requires.

## The shape (two steps: persist the trace, then submit the action)

The working reference is `verticals/legal/src/api/generateDraft.ts`. There is no `createAiJudgment`/`createReasoningTrace` helper — you insert the `reasoning_trace` row, then call `submitAction` with its id.

```typescript
import { randomUUID } from 'node:crypto';
import { submitAction, withActionContext, type ActionContext, type ActionResult } from '@exsto/substrate';
import { callClaudeDrafter } from '../adapters/claude.js';

const AGENT_ACTOR_ID = '...';  // the tenant's agent actor (actor_type = 'agent')

export async function generateDraft(ctx: ActionContext, input: GenerateDraftInput): Promise<ActionResult> {
  const result = await callClaudeDrafter({ prompt });

  // 1. Persist the reasoning trace first (reasoning_trace is append-only).
  const reasoningTraceId = await persistReasoningTrace(ctx, {
    prompt,
    evidence: result.reasoningTrace.evidence,
    alternatives: result.reasoningTrace.alternatives_considered,
    conclusion: result.reasoningTrace.conclusion,
    confidence: result.reasoningTrace.confidence,   // honest, < 1.0
    modelIdentity: result.modelIdentity,
    fullTrace: result.reasoningTrace,
  });

  // 2. Submit the action with the trace id. submitAction enforces requires_reasoning_trace.
  return submitAction(ctx, {
    actionKindName: 'legal.draft.generate',
    intentKind: 'enforcement',
    reasoningTraceId,
    payload: {
      matter_entity_id: input.matterEntityId,
      document_markdown: result.documentMarkdown,
      model_identity: result.modelIdentity,
      reasoning_trace_id: reasoningTraceId,
    },
  });
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistTraceArgs): Promise<string> {
  const id = randomUUID();
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [id, ctx.tenantId, AGENT_ACTOR_ID, args.prompt,
       JSON.stringify(args.evidence), JSON.stringify(args.alternatives),
       args.conclusion, args.confidence, args.modelIdentity, JSON.stringify(args.fullTrace)]
    );
  });
  return id;
}
```

For an AI **judgment** specifically, the generic primitive already threads the trace: `recordJudgment(ctx, { subjectEntityId, judgmentKindName, value, confidence, reasoningTraceId })`. To capture a standalone trace through the generic surface, submit the `reasoning.capture` action kind.

## What the AI feedback loop expects

Every AI action that gets contested or whose downstream outcome is recorded contributes to the agent's calibration data. For this to work, the reasoning trace must include:

- **Evidence with row_refs.** A reference like `"entity:abc-123"` lets the substrate trace which inputs the agent considered.
- **Alternatives.** Without alternatives, the agent's decision looks like the only option. With them, the substrate can analyze "agent considered X but chose Y; was Y right?"
- **Confidence on the selected conclusion.** Calibration analysis compares predicted confidence to actual outcome rates.
- **Uncertainty / ambiguities.** What the agent itself flagged as worth verifying. Gold for review queues.
- **Model identity (and prompt version).** Matters when comparing across model upgrades. Record `response.model`.

## Autonomy tier handling

`submitAction` resolves the tier as `input.autonomyTier ?? action_kind_definition.default_autonomy_tier`. Common configurations for AI actions:

- **`autonomous`** for low-risk reads-and-tags (suggesting a category, applying a label).
- **`notify`** for moderate-risk writes (creating a judgment, updating an attribute).
- **`approve`** for higher-risk writes (overriding a human-set value, marking an entity as resolved).
- **`suggest`** for irreversible or external-side-effecting writes (sending an email, triggering a payment).

If the agent's confidence is low, escalate explicitly by passing `autonomyTier`:

```typescript
return submitAction(ctx, {
  actionKindName,
  intentKind: 'reflection',
  reasoningTraceId,
  autonomyTier: input.confidence < 0.7 ? 'approve' : undefined,  // undefined => kind default
  payload,
});
```

## Common mistakes

**Treating AI actions like human actions.** Skipping the reasoning trace because "it's just a suggestion" loses the feedback-loop signal and (for trace-required kinds) makes `submitAction` throw. Every AI action gets a trace.

**Putting confidence at 1.0.** AI is rarely certain. Confidence reflects actual uncertainty. If your agent always claims 1.0, calibration is impossible.

**Skipping alternatives in reasoning.** Without alternatives, the substrate cannot tell whether the agent considered the right options.

**Bypassing the action layer for "internal" AI uses.** There is no internal-only path. Every AI write goes through `submitAction` (and a vertical never raw-INSERTs — see `verticals/legal/CLAUDE.md`).

**Submitting the action before the trace exists.** Persist the `reasoning_trace` row first, then submit with its id, so the `action.reasoning_trace_id` foreign key resolves.

## Related ADRs and patterns

- ADR 0020: Reasoning capture for agent actions
- ADR 0022: Governance gradients
- ADR 0028: AI effectiveness as a derived property
- Pattern: `action-handler.md` (the general pattern this specializes)
- Pattern: `mcp-tool.md` (MCP tools that wrap AI behavior call into these handlers)
- Skill: `exsto-ai-operation` (the verified guide); use the `claude-api` skill for Anthropic SDK specifics
