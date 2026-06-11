import { randomUUID } from 'node:crypto'
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'

const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface CachedReasoningTrace {
  evidence: unknown[]
  alternatives_considered: unknown[]
  conclusion: string
  confidence: number
  ambiguities: unknown[]
  [key: string]: unknown
}

export interface CacheDraftInput {
  matterEntityId: string
  documentKind: 'operating_agreement' | 'engagement_letter'
  documentMarkdown: string
  prompt: string
  reasoningTrace: CachedReasoningTrace
  modelIdentity: string
}

// Persists a pre-generated draft document + its reasoning trace as if Sage had
// just produced it. Used by the demo seed so the walkthrough does not depend
// on a live Claude API call (and so the cached draft can be a known-good
// example rather than whatever Claude happens to produce on the day).
export async function cacheDraft(
  ctx: ActionContext,
  input: CacheDraftInput,
): Promise<ActionResult> {
  const traceId = await persistReasoningTrace(ctx, {
    prompt: input.prompt,
    trace: input.reasoningTrace,
    modelIdentity: input.modelIdentity,
  })

  return submitAction(ctx, {
    actionKindName: 'draft.generate',
    intentKind: 'enforcement',
    reasoningTraceId: traceId,
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: input.documentKind,
      document_markdown: input.documentMarkdown,
      model_identity: input.modelIdentity,
      reasoning_trace_id: traceId,
      jurisdiction: 'NC',
    },
  })
}

interface PersistArgs {
  prompt: string
  trace: CachedReasoningTrace
  modelIdentity: string
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistArgs): Promise<string> {
  const id = randomUUID()
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        CLAUDE_AGENT_ACTOR_ID,
        args.prompt,
        JSON.stringify(args.trace.evidence),
        JSON.stringify(args.trace.alternatives_considered),
        args.trace.conclusion,
        clampConfidence(args.trace.confidence),
        args.modelIdentity,
        JSON.stringify(args.trace),
      ],
    )
  })
  return id
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
