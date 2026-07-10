// MACHINE-COMMS-1 (WP3) — TRANSCRIPT EXTRACTION: transcripts stop being stored-
// but-mute. Given a transcript on a matter, the worker distills it into NOTES —
// one summary note (note_source 'ai_summary') plus one note per extracted fact /
// action item (note_source 'ai_extraction') — attached to the matter through the
// core note actions (api/notes.ts) and pointing back at the transcript via
// note_about. The notes feed getClientContext immediately.
//
// Honesty: extracted "facts" are AI output — the capability's gate is `attorney`
// (a composed extraction stage PARKS for attorney review after the notes land),
// every note carries agent provenance + the model identity, and the reasoning
// trace id rides each note's metadata. WORKER-ONLY (model call).
import { randomUUID } from 'node:crypto'
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import { callClaudeDrafter, type ClaudeDraftResult } from '../adapters/claude.js'
import { loadTranscriptExtractionPrompt } from '../templates/loader.js'
import { getMatter } from '../queries/matters.js'
import { createNote } from './notes.js'

const CLAUDE_AGENT_ACTOR_ID = '00000000-0000-0000-0001-000000000004'

export interface RunTranscriptExtractionInput {
  matterEntityId: string
  // Optional explicit transcript; defaults to the matter's latest transcript
  // (direct transcript_of_matter link, else the legacy two-hop).
  transcriptEntityId?: string
  // Optional attorney focus ("pull out everything about the lease terms").
  instructions?: string
}

export interface TranscriptExtractionResult {
  transcriptEntityId: string
  summaryNoteId: string
  extractedNoteIds: string[]
  factCount: number
  actionItemCount: number
}

// Pure parser for the output contract (exported for tests): summary markdown,
// then `## Extracted facts and action items` with `- [fact] …` / `- [action] …`
// bullets. Unparseable bullets are dropped (never guessed into a note).
export function parseExtractionOutput(raw: string): {
  summary: string
  items: Array<{ kind: 'fact' | 'action'; text: string }>
} {
  const text = raw.trim()
  const splitAt = text.search(/^##\s+Extracted facts and action items\s*$/im)
  const summary = (splitAt >= 0 ? text.slice(0, splitAt) : text).trim()
  const tail = splitAt >= 0 ? text.slice(splitAt) : ''
  const items: Array<{ kind: 'fact' | 'action'; text: string }> = []
  for (const m of tail.matchAll(/^-\s*\[(fact|action)\]\s+(.+)$/gim)) {
    const body = m[2]!.trim()
    if (body) items.push({ kind: m[1]!.toLowerCase() as 'fact' | 'action', text: body })
  }
  return { summary, items }
}

async function resolveTranscript(
  ctx: ActionContext,
  matterEntityId: string,
  explicitId?: string,
): Promise<{ transcriptEntityId: string; transcriptText: string } | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ id: string; body: string | null }>(
      explicitId
        ? `SELECT e.id,
                  (SELECT a.value #>> '{}' FROM attribute a
                     JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                    WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                      AND ak.kind_name = 'transcript_text'
                    ORDER BY a.valid_from DESC LIMIT 1) AS body
             FROM entity e
             JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
                  AND ekd.kind_name = 'transcript'
            WHERE e.tenant_id = $1 AND e.id = $2`
        : `WITH direct AS (
             SELECT r.source_entity_id AS tid FROM relationship r
               JOIN relationship_kind_definition k ON k.id = r.relationship_kind_id
              WHERE r.tenant_id = $1 AND r.target_entity_id = $2
                AND k.kind_name = 'transcript_of_matter'
           ),
           two_hop AS (
             SELECT t.source_entity_id AS tid FROM relationship t
               JOIN relationship_kind_definition tk ON tk.id = t.relationship_kind_id
                    AND tk.kind_name = 'transcript_of'
               JOIN relationship c ON c.source_entity_id = t.target_entity_id
               JOIN relationship_kind_definition ck ON ck.id = c.relationship_kind_id
                    AND ck.kind_name = 'call_of'
              WHERE t.tenant_id = $1 AND c.target_entity_id = $2
           )
           SELECT e.id,
                  (SELECT a.value #>> '{}' FROM attribute a
                     JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                    WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                      AND ak.kind_name = 'transcript_text'
                    ORDER BY a.valid_from DESC LIMIT 1) AS body
             FROM entity e
            WHERE e.tenant_id = $1
              AND e.id IN (SELECT tid FROM direct UNION SELECT tid FROM two_hop)
            ORDER BY e.created_at DESC
            LIMIT 1`,
      explicitId ? [ctx.tenantId, explicitId] : [ctx.tenantId, matterEntityId],
    )
    const row = res.rows[0]
    if (!row || !row.body?.trim()) return null
    return { transcriptEntityId: row.id, transcriptText: row.body }
  })
}

const MAX_TRANSCRIPT_CHARS = 150_000

export async function runTranscriptExtraction(
  ctx: ActionContext,
  input: RunTranscriptExtractionInput,
): Promise<TranscriptExtractionResult> {
  const agentCtx: ActionContext = { tenantId: ctx.tenantId, actorId: CLAUDE_AGENT_ACTOR_ID }

  const matter = await getMatter(agentCtx, input.matterEntityId)
  if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)

  const transcript = await resolveTranscript(
    agentCtx,
    input.matterEntityId,
    input.transcriptEntityId,
  )
  if (!transcript) {
    throw new Error(
      'No transcript with text found on this matter — record or import a consultation transcript first.',
    )
  }
  let transcriptText = transcript.transcriptText
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    transcriptText = `${transcriptText.slice(0, MAX_TRANSCRIPT_CHARS)}\n\n[TRUNCATED at ${MAX_TRANSCRIPT_CHARS} characters]`
  }

  const matterFacts = {
    matter_number: matter.matterNumber,
    service_key: matter.serviceKey,
    client_name: matter.clientName || null,
  }
  const instructionsSection = input.instructions?.trim()
    ? `## Attorney focus for this extraction\n\n${input.instructions.trim()}`
    : ''

  // Function replacers: transcript + instructions are untrusted content.
  const prompt = loadTranscriptExtractionPrompt()
    .replaceAll('{{instructions_section}}', () => instructionsSection)
    .replaceAll('{{matter_facts_json}}', () => JSON.stringify(matterFacts, null, 2))
    .replaceAll('{{transcript_text}}', () => transcriptText)

  const model = await callClaudeDrafter(agentCtx.tenantId, { prompt, maxTokens: 6000 })
  const parsed = parseExtractionOutput(model.documentMarkdown)
  if (!parsed.summary.trim()) {
    throw new Error('Transcript extraction produced no summary — nothing recorded (no-simulate).')
  }
  const reasoningTraceId = await persistExtractionTrace(agentCtx, { prompt, result: model })

  const noteMeta = {
    reasoning_trace_id: reasoningTraceId,
    model_identity: model.modelIdentity,
    transcript_entity_id: transcript.transcriptEntityId,
  }
  const summaryNote = await createNote(agentCtx, {
    body: parsed.summary,
    matterEntityId: input.matterEntityId,
    aboutEntityId: transcript.transcriptEntityId,
    source: 'ai_summary',
    sourceType: 'agent',
    sourceRef: model.modelIdentity,
    metadata: noteMeta,
  })
  const extractedNoteIds: string[] = []
  let factCount = 0
  let actionItemCount = 0
  for (const item of parsed.items) {
    const prefix = item.kind === 'action' ? 'Action item' : 'Fact'
    const note = await createNote(agentCtx, {
      body: `${prefix}: ${item.text}`,
      matterEntityId: input.matterEntityId,
      aboutEntityId: transcript.transcriptEntityId,
      source: 'ai_extraction',
      sourceType: 'agent',
      sourceRef: model.modelIdentity,
      metadata: noteMeta,
    })
    extractedNoteIds.push(note.noteEntityId)
    if (item.kind === 'action') actionItemCount++
    else factCount++
  }

  // The audit event (runtime-defined kind, demo/seed-comms-kinds.ts).
  await submitAction(agentCtx, {
    actionKindName: 'event.record',
    intentKind: 'automatic_sync',
    payload: {
      event_kind_name: 'transcript.extracted',
      primary_entity_id: input.matterEntityId,
      secondary_entity_ids: [transcript.transcriptEntityId],
      data: {
        transcript_entity_id: transcript.transcriptEntityId,
        summary_note_id: summaryNote.noteEntityId,
        fact_count: factCount,
        action_item_count: actionItemCount,
        model_identity: model.modelIdentity,
        reasoning_trace_id: reasoningTraceId,
      },
      source_type: 'agent',
      source_ref: CLAUDE_AGENT_ACTOR_ID,
    },
  })

  return {
    transcriptEntityId: transcript.transcriptEntityId,
    summaryNoteId: summaryNote.noteEntityId,
    extractedNoteIds,
    factCount,
    actionItemCount,
  }
}

async function persistExtractionTrace(
  ctx: ActionContext,
  args: { prompt: string; result: ClaudeDraftResult },
): Promise<string> {
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
        JSON.stringify(args.result.reasoningTrace.evidence ?? []),
        JSON.stringify(args.result.reasoningTrace.alternatives_considered ?? []),
        args.result.reasoningTrace.conclusion ?? '',
        Math.min(
          1,
          Math.max(
            0,
            typeof args.result.reasoningTrace.confidence === 'number'
              ? args.result.reasoningTrace.confidence
              : 0.5,
          ),
        ),
        args.result.modelIdentity,
        JSON.stringify({
          ...(args.result.reasoningTrace as unknown as Record<string, unknown>),
          prompt_config: { prompt_id: 'transcript-extraction@repo', kind: 'transcript_extraction' },
        }),
      ],
    )
  })
  return id
}
