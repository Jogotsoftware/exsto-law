// Granola adapter — REAL integration surface (Phase 0, WP3) plus the local
// stub driver behind the same interface (binding Lesson #1: stub assumptions
// must not leak into callers).
//
// Production path (REQ-CALL-01..04):
// 1. Granola POSTs a webhook on call completion → apps/legal-demo
//    /api/webhooks/granola verifies the HMAC signature, stores the raw payload
//    via raw_event.ingest (raw_event_log, invariant 14), and enqueues
//    legal.granola.project — thin and fast-ack.
// 2. The worker job fetches the full transcript + structured notes via this
//    adapter and projects to call_session + transcript through call.ingest.
// 3. Audio is never retained by the product (Granola deletes post-transcription).
import { createHmac, timingSafeEqual } from 'node:crypto'
import { loadConnection } from './connectionStore.js'

// Granola's public API is in beta; the base is overridable so a schema move is
// a config change, not a code change.
const GRANOLA_API_BASE = process.env.GRANOLA_API_BASE ?? 'https://api.granola.ai/v1'

export interface GranolaCallData {
  callId: string
  startedAt: string | null
  endedAt: string | null
  durationSeconds: number | null
  attendeeEmails: string[]
  transcriptText: string
  notes: Record<string, unknown> | null
}

type GranolaSecret = { api_key: string; webhook_secret?: string }

async function granolaKey(tenantId: string): Promise<string | null> {
  // Connected key (Vault) wins; env fallback keeps local dev working.
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola')
  return conn?.secret.api_key ?? process.env.GRANOLA_API_KEY ?? null
}

export async function granolaWebhookSecret(tenantId: string): Promise<string | null> {
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola')
  return conn?.secret.webhook_secret ?? process.env.GRANOLA_WEBHOOK_SECRET ?? null
}

// HMAC-SHA256 signature check over the raw request body. Constant-time
// comparison; accepts an optional "sha256=" prefix on the header value.
export function verifyGranolaSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false
  const given = signatureHeader.replace(/^sha256=/, '').trim()
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')
  const a = Buffer.from(given, 'hex')
  const b = Buffer.from(expected, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

// Fetch the full call data (transcript + structured notes) from Granola.
// Tolerant parsing: webhook payloads that already embed the transcript skip
// the API round-trip entirely (see normalizeGranolaPayload), so this is only
// called when a fetch is actually needed.
export async function fetchGranolaCall(tenantId: string, callId: string): Promise<GranolaCallData> {
  const key = await granolaKey(tenantId)
  if (!key) {
    throw new Error(
      'Granola is not connected (no API key in Vault or GRANOLA_API_KEY env). Connect Granola from Settings.',
    )
  }
  const res = await fetch(`${GRANOLA_API_BASE}/calls/${encodeURIComponent(callId)}`, {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    throw new Error(`Granola API returned ${res.status} for call ${callId}`)
  }
  const data = (await res.json()) as Record<string, unknown>
  const normalized = normalizeGranolaPayload(data)
  if (!normalized) {
    throw new Error(`Granola API payload for call ${callId} had no recognizable transcript`)
  }
  return normalized
}

// Normalize a Granola-shaped payload (webhook or API response) into
// GranolaCallData. Returns null when no transcript content is present (the
// caller should then fetch via the API). Field names are matched defensively —
// the beta API has shifted shapes before.
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

// ───────────────────────────────────────────────────────────────────────────
// Local stub driver (demo seed + local dev where webhooks can't reach
// localhost). Same downstream interface as the real path: the produced payload
// flows through raw_event.ingest → legal.granola.project → call.ingest.
// ───────────────────────────────────────────────────────────────────────────

export interface StubCallInput {
  matterClientName: string
  matterCompanyName: string
  matterSummary: string
  questionnaireHighlights: Record<string, unknown>
}

export interface StubGranolaPayload {
  call_id: string
  started_at: string
  ended_at: string
  transcript: string
  attendees: Array<{ email: string }>
  transcript_source: 'stub'
}

export function buildStubCallSession(
  input: StubCallInput,
  attendeeEmail = 'client@example.test',
): StubGranolaPayload {
  const startedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString()
  const endedAt = new Date().toISOString()
  return {
    call_id: `stub-${Date.now()}`,
    started_at: startedAt,
    ended_at: endedAt,
    transcript: renderStubTranscript(input),
    attendees: [{ email: attendeeEmail }],
    transcript_source: 'stub',
  }
}

function renderStubTranscript(input: StubCallInput): string {
  const highlights = Object.entries(input.questionnaireHighlights)
    .map(([k, v]) => `- ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join('\n')

  return [
    `[STUB CONSULTATION TRANSCRIPT — generated locally for the demo path, not a real Granola payload]`,
    ``,
    `Attorney (Juan Carlos): Thanks for taking the time today, ${input.matterClientName}. I want to confirm a few details about ${input.matterCompanyName}.`,
    `Client: Sure, ready when you are.`,
    `Attorney: From the intake form you sent in, here's what I'm working with:`,
    highlights,
    ``,
    `Attorney: Anything in there you want to change?`,
    `Client: No, that all matches our intent.`,
    `Attorney: Got it. I'll assemble the first draft and circulate it for revisions.`,
    ``,
    `Summary: ${input.matterSummary}`,
  ].join('\n')
}
