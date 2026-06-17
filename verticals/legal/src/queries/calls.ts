import { withActionContext, type ActionContext } from '@exsto/substrate'

// Calls / meetings read layer (beta sprint Obj 8). A consultation is a
// call_session entity (Granola-ingested) linked to its matter via call_of and to
// its transcript via transcript_of. The Granola SUMMARY lives in the call_notes
// attribute; the full text in the transcript. These reads surface calls on a
// matter, on a contact (across that contact's matters), and the unmatched queue.

export interface CallSummary {
  callEntityId: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  granolaCallId: string | null
  // The Granola structured summary/notes (clickable in the UI) — null if none.
  summary: Record<string, unknown> | null
  transcriptText: string | null
  transcriptWordCount: number | null
  matterEntityId: string | null
  matterNumber: string | null
  recordedAt: string
}

type CallRow = {
  call_entity_id: string
  started_at: string | null
  ended_at: string | null
  duration_seconds: string | null
  granola_call_id: string | null
  summary: Record<string, unknown> | null
  transcript_text: string | null
  word_count: string | null
  matter_entity_id: string | null
  matter_number: string | null
  recorded_at: Date
}

// Shared projection: pull each call_session's attributes, its linked transcript,
// and (optionally) the matter it is attached to. `whereClause`/`params` scope it.
function callSelect(whereClause: string): string {
  return `
    WITH attrs AS (
      SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value
      FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
    )
    SELECT
      e.id AS call_entity_id,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'call_started_at')      AS started_at,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'call_ended_at')        AS ended_at,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'call_duration_seconds') AS duration_seconds,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'granola_call_id')      AS granola_call_id,
      (SELECT value FROM attrs WHERE entity_id = e.id AND kind_name = 'call_notes')                    AS summary,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = t.id AND kind_name = 'transcript_text')      AS transcript_text,
      (SELECT value #>> '{}' FROM attrs WHERE entity_id = t.id AND kind_name = 'transcript_word_count') AS word_count,
      m.id   AS matter_entity_id,
      m.name AS matter_number,
      e.created_at AS recorded_at
    FROM entity e
    JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'call_session'
    LEFT JOIN relationship tr ON tr.target_entity_id = e.id
      AND tr.relationship_kind_id = (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'transcript_of')
    LEFT JOIN entity t ON t.id = tr.source_entity_id
    LEFT JOIN relationship cr ON cr.source_entity_id = e.id
      AND cr.relationship_kind_id = (SELECT id FROM relationship_kind_definition WHERE tenant_id = $1 AND kind_name = 'call_of')
      AND (cr.valid_to IS NULL OR cr.valid_to > now())
    LEFT JOIN entity m ON m.id = cr.target_entity_id
    WHERE e.tenant_id = $1 AND e.status = 'active' AND ${whereClause}
    ORDER BY started_at DESC NULLS LAST, e.created_at DESC`
}

function mapCall(r: CallRow): CallSummary {
  return {
    callEntityId: r.call_entity_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    durationSeconds: r.duration_seconds != null ? Number(r.duration_seconds) : null,
    granolaCallId: r.granola_call_id,
    summary: r.summary ?? null,
    transcriptText: r.transcript_text,
    transcriptWordCount: r.word_count != null ? Number(r.word_count) : null,
    matterEntityId: r.matter_entity_id,
    matterNumber: r.matter_number,
    recordedAt: r.recorded_at.toISOString(),
  }
}

// Calls attached to a matter (via call_of).
export async function listCallsForMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<CallSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<CallRow>(callSelect(`cr.target_entity_id = $2`), [
      ctx.tenantId,
      matterEntityId,
    ])
    return res.rows.map(mapCall)
  })
}

// Calls associated with a contact — across every matter the contact is on
// (client_of: contact → matter, then call_of: call → matter). So a contact's page
// shows all its consultation calls, not just one matter's.
export async function listCallsForContact(
  ctx: ActionContext,
  contactEntityId: string,
): Promise<CallSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<CallRow>(
      callSelect(
        `cr.target_entity_id IN (
           SELECT r.target_entity_id FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
           WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND (r.valid_to IS NULL OR r.valid_to > now())
         )`,
      ),
      [ctx.tenantId, contactEntityId],
    )
    return res.rows.map(mapCall)
  })
}

// The review queue: ingested calls NOT yet attached to any matter (no call_of).
export async function listUnmatchedCalls(ctx: ActionContext): Promise<CallSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<CallRow>(
      callSelect(
        `NOT EXISTS (
           SELECT 1 FROM relationship r
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'call_of'
           WHERE r.tenant_id = $1 AND r.source_entity_id = e.id AND (r.valid_to IS NULL OR r.valid_to > now())
         )`,
      ),
      [ctx.tenantId],
    )
    return res.rows.map(mapCall)
  })
}
