import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { getMatter } from '../queries/matters.js'

// Record a REAL consultation call against a matter from a transcript the attorney
// provides (paste / upload). This is the manual counterpart to the Granola webhook
// path — it runs through the SAME call.ingest projection, but the transcript is
// real content (transcript_source='manual') and the facts carry HUMAN provenance
// (source_type='human', source_ref=actorId), since the attorney asserted them.
//
// It replaces the old `simulateCall` synthetic-data driver: a production pilot
// records real calls, never generated ones.

// Mirrors the matter page's MAX_TRANSCRIPT_UPLOAD_BYTES (1 MB of plain text).
const MAX_TRANSCRIPT_TEXT_CHARS = 1_000_000

export interface RecordManualCallInput {
  matterEntityId: string
  // The real transcript text (required — there is no synthetic fallback).
  transcriptText: string
  // Optional structured summary (the attorney's notes / a pasted Granola summary).
  summary?: Record<string, unknown> | null
  startedAtIso?: string | null
  endedAtIso?: string | null
}

export async function recordManualCall(
  ctx: ActionContext,
  input: RecordManualCallInput,
): Promise<ActionResult> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) {
    throw new Error(`Matter not found: ${input.matterEntityId}`)
  }
  const transcript = input.transcriptText.trim()
  if (!transcript) {
    throw new Error('Paste the call transcript first.')
  }
  // Server-side twin of the matter page's 1 MB upload cap: the text lands in
  // append-only storage and auto-fans into a model call, so an oversized paste
  // that bypasses the UI must be rejected here too.
  if (transcript.length > MAX_TRANSCRIPT_TEXT_CHARS) {
    throw new Error(
      'That transcript is too long — transcripts are capped at 1,000,000 characters (about 1 MB of plain text).',
    )
  }

  // A stable, clearly-manual call id keeps call.ingest idempotent without
  // colliding with Granola's ids. The id IS the provenance ref.
  const callId = `manual-${globalThis.crypto.randomUUID()}`
  const startedAt = input.startedAtIso ?? null
  const endedAt = input.endedAtIso ?? null
  const durationSeconds =
    startedAt && endedAt
      ? Math.max(
          0,
          Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000),
        )
      : null

  return submitAction(ctx, {
    actionKindName: 'call.ingest',
    // The attorney is deliberately recording an observed consultation.
    intentKind: 'reflection',
    payload: {
      granola_call_id: callId,
      matter_entity_id: input.matterEntityId,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: durationSeconds,
      transcript_text: transcript,
      transcript_source: 'manual',
      notes: input.summary ?? null,
      attendee_emails: [],
      source_type: 'human',
      source_ref: ctx.actorId,
    },
  })
}
