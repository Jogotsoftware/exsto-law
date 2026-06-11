import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { runPerplexityResearch, type ResearchResult } from '../adapters/perplexity.js'

export interface MatterResearchInput {
  matterEntityId: string
  question: string
}

export interface MatterResearchEntry {
  eventId: string
  question: string
  answer: string
  citations: string[]
  model: string
  recordedAt: string
}

// Substrate recording half — split out from runMatterResearch so the recording
// + timeline behavior is testable without a live Perplexity key. Records the
// query+answer as a research.recorded event on the matter, provenance
// integration:perplexity (the exsto-external-api pattern: external data becomes
// a substrate fact through the action layer).
export async function recordMatterResearch(
  ctx: ActionContext,
  input: { matterEntityId: string; question: string; result: ResearchResult },
): Promise<{ eventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'exploration',
    payload: {
      event_kind_name: 'research.recorded',
      primary_entity_id: input.matterEntityId,
      source_type: 'integration',
      source_ref: 'integration:perplexity',
      data: {
        question: input.question,
        answer: input.result.answer,
        citations: input.result.citations,
        model: input.result.model,
      },
    },
  })
  // event.record returns { eventId } as its single effect.
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// Ask Perplexity a research question scoped to a matter, then record it. The
// answer + citations are returned to the caller AND persisted to the timeline.
export async function runMatterResearch(
  ctx: ActionContext,
  input: MatterResearchInput,
): Promise<MatterResearchEntry> {
  const question = input.question.trim()
  if (!question) throw new Error('Ask a research question first.')

  const result = await runPerplexityResearch(ctx.tenantId, { question })
  const { eventId } = await recordMatterResearch(ctx, {
    matterEntityId: input.matterEntityId,
    question,
    result,
  })

  return {
    eventId,
    question,
    answer: result.answer,
    citations: result.citations,
    model: result.model,
    recordedAt: new Date().toISOString(),
  }
}

// Prior research for a matter, newest first — the panel's history.
export async function listMatterResearch(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<MatterResearchEntry[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: {
        question?: string
        answer?: string
        citations?: string[]
        model?: string
      }
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'research.recorded'
         AND e.primary_entity_id = $2::uuid
       ORDER BY e.occurred_at DESC`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map((r) => ({
      eventId: r.event_id,
      question: r.payload.question ?? '',
      answer: r.payload.answer ?? '',
      citations: r.payload.citations ?? [],
      model: r.payload.model ?? '',
      recordedAt: r.occurred_at,
    }))
  })
}
