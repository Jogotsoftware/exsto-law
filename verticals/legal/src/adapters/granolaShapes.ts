// Granola data shapes + the field-name-tolerant payload normalizer. A leaf module
// (no api-key, no MCP, no Vault) imported by BOTH the granola adapter face
// (granola.ts) and the MCP client (granolaMcp.ts), so neither has to import the
// other for these — keeping the value graph acyclic. The normalizer is reused
// verbatim from the retired REST adapter; it already tolerates the many field-name
// variants Granola has shipped (webhook, REST, and now MCP payloads).

export interface GranolaCallData {
  callId: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  attendeeEmails: string[]
  transcriptText: string
  notes: Record<string, unknown> | null
}

export interface GranolaFolder {
  id: string
  name: string
}

export interface GranolaNoteSummary {
  id: string
  title: string
  createdAt: string | null
  ownerEmail: string | null
}

export interface GranolaNoteDetail {
  id: string
  title: string
  startedAt: string | null
  attendeeEmails: string[]
  transcriptText: string
  summaryMarkdown: string | null
}

// Normalize a Granola-shaped payload (webhook, MCP tool result, ...) into
// GranolaCallData. Returns null when no transcript content is present. Field names
// are matched defensively — the beta API has shifted shapes before.
export function normalizeGranolaPayload(payload: Record<string, unknown>): GranolaCallData | null {
  const p = payload as {
    id?: string
    call_id?: string
    external_call_id?: string
    started_at?: string
    start_time?: string
    ended_at?: string
    end_time?: string
    duration_seconds?: number
    attendees?: Array<{ email?: string } | string>
    participants?: Array<{ email?: string } | string>
    transcript?: string | { text?: string }
    transcript_text?: string
    notes?: Record<string, unknown>
    summary?: Record<string, unknown> | string
  }
  const callId = p.call_id ?? p.id ?? p.external_call_id
  if (!callId) return null

  const transcriptText =
    typeof p.transcript === 'string'
      ? p.transcript
      : (p.transcript?.text ?? p.transcript_text ?? null)
  if (!transcriptText) return null

  const rawAttendees = p.attendees ?? p.participants ?? []
  const attendeeEmails = rawAttendees
    .map((a) => (typeof a === 'string' ? a : (a.email ?? null)))
    .filter((e): e is string => Boolean(e && e.includes('@')))

  const startedAt = p.started_at ?? p.start_time ?? null
  const endedAt = p.ended_at ?? p.end_time ?? null
  let durationSeconds = p.duration_seconds ?? null
  if (durationSeconds == null && startedAt && endedAt) {
    durationSeconds = Math.round(
      (new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000,
    )
  }

  const notes = p.notes ?? (typeof p.summary === 'object' && p.summary !== null ? p.summary : null)

  return {
    callId: String(callId),
    startedAt,
    endedAt,
    durationSeconds,
    attendeeEmails,
    transcriptText,
    notes: notes as Record<string, unknown> | null,
  }
}
