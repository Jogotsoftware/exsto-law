// Granola adapter — REAL integration surface (Phase 0, WP3). The transcript
// projection (call.ingest) is shared with the manual-entry path so the attorney
// can record a real call when Granola didn't capture it; there is no synthetic
// transcript generator (the demo/stub driver was removed for the beta pilot).
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

// Granola's public REST API. Base is overridable so a schema move is a config
// change, not a code change. The public surface lives under public-api.granola.ai
// (verified against the live API; the old api.granola.ai host 404s every route).
const GRANOLA_API_BASE = process.env.GRANOLA_API_BASE ?? 'https://public-api.granola.ai/v1'

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

async function granolaKey(tenantId: string, actorId?: string | null): Promise<string | null> {
  // Connected key (Vault) wins; env fallback keeps local dev working. Granola is
  // per-attorney (migration 0016), so the key is scoped to actorId.
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola', actorId)
  return conn?.secret.api_key ?? process.env.GRANOLA_API_KEY ?? null
}

export async function granolaWebhookSecret(
  tenantId: string,
  actorId?: string | null,
): Promise<string | null> {
  const conn = await loadConnection<GranolaSecret>(tenantId, 'granola', actorId)
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
export async function fetchGranolaCall(
  tenantId: string,
  callId: string,
  actorId?: string | null,
): Promise<GranolaCallData> {
  const key = await granolaKey(tenantId, actorId)
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
// Folder/note browse + transcript pull (REST). Drives the attorney "import a
// Granola folder" flow: list folders → list a folder's notes → pull one note's
// metadata (preview) or full transcript (import). Distinct from the webhook path
// above, which is push-driven; this is the attorney pulling existing notes in.
//
// EVERY field below can be null/empty per the API contract — parse defensively.
// ───────────────────────────────────────────────────────────────────────────

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

// Shared GET helper: resolves the key (throwing the same "not connected" error
// as fetchGranolaCall so the UI can react to it), issues the request, and turns
// a non-2xx into a clear error. 404 is surfaced as-is — the caller decides
// whether a missing note is fatal (a brand-new meeting can 404 transiently).
async function granolaGet(
  tenantId: string,
  path: string,
  actorId?: string | null,
): Promise<Record<string, unknown>> {
  const key = await granolaKey(tenantId, actorId)
  if (!key) {
    throw new Error(
      'Granola is not connected (no API key in Vault or GRANOLA_API_KEY env). Connect Granola from Settings.',
    )
  }
  const res = await fetch(`${GRANOLA_API_BASE}${path}`, {
    headers: { authorization: `Bearer ${key}` },
  })
  if (!res.ok) {
    throw new Error(`Granola API returned ${res.status} for ${path}`)
  }
  return (await res.json()) as Record<string, unknown>
}

// Cursor pagination: the API caps page_size at 30 and returns { ..., hasMore,
// cursor }. We loop until hasMore is false, passing the prior cursor. A hard cap
// on pages prevents an unbounded loop if the API ever lies about hasMore.
async function paginate<T>(
  tenantId: string,
  basePath: string,
  itemsKey: string,
  mapItem: (raw: Record<string, unknown>) => T | null,
  actorId?: string | null,
): Promise<T[]> {
  const out: T[] = []
  let cursor: string | null = null
  for (let page = 0; page < 100; page++) {
    const sep = basePath.includes('?') ? '&' : '?'
    const cursorParam = cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
    const data = await granolaGet(tenantId, `${basePath}${sep}page_size=30${cursorParam}`, actorId)
    const items = Array.isArray(data[itemsKey]) ? (data[itemsKey] as Record<string, unknown>[]) : []
    for (const raw of items) {
      const mapped = mapItem(raw)
      if (mapped) out.push(mapped)
    }
    if (data.hasMore !== true || typeof data.cursor !== 'string' || !data.cursor) break
    cursor = data.cursor
  }
  return out
}

// All folders for the tenant. parent_folder_id is ignored here — notes are
// listed by folder_id, which already includes child folders (API contract).
export async function listGranolaFolders(
  tenantId: string,
  actorId?: string | null,
): Promise<GranolaFolder[]> {
  return paginate<GranolaFolder>(
    tenantId,
    '/folders',
    'folders',
    (raw) => {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id) return null
      return { id, name: typeof raw.name === 'string' ? raw.name : '(untitled folder)' }
    },
    actorId,
  )
}

// Note summaries in a folder. The list endpoint does NOT include attendees or
// transcript — those need a per-note GET (see getGranolaNote).
export async function listGranolaNotesInFolder(
  tenantId: string,
  folderId: string,
  actorId?: string | null,
): Promise<GranolaNoteSummary[]> {
  return paginate<GranolaNoteSummary>(
    tenantId,
    `/notes?folder_id=${encodeURIComponent(folderId)}`,
    'notes',
    (raw) => {
      const id = typeof raw.id === 'string' ? raw.id : null
      if (!id) return null
      const owner = (raw.owner ?? null) as { email?: unknown } | null
      return {
        id,
        title: typeof raw.title === 'string' && raw.title ? raw.title : '(untitled note)',
        createdAt: typeof raw.created_at === 'string' ? raw.created_at : null,
        ownerEmail: owner && typeof owner.email === 'string' ? owner.email.toLowerCase() : null,
      }
    },
    actorId,
  )
}

// Pull one note. Without opts.transcript we skip ?include=transcript to stay
// light (preview only needs metadata + attendees). attendeeEmails is the union
// of attendees[].email, calendar_event.invitees[].email and the organiser —
// lowercased, deduped — because Granola populates these inconsistently.
export async function getGranolaNote(
  tenantId: string,
  noteId: string,
  opts?: { transcript?: boolean },
  actorId?: string | null,
): Promise<GranolaNoteDetail> {
  const include = opts?.transcript ? '?include=transcript' : ''
  const note = await granolaGet(tenantId, `/notes/${encodeURIComponent(noteId)}${include}`, actorId)

  const emails = new Set<string>()
  const addEmail = (v: unknown) => {
    if (typeof v === 'string' && v.includes('@')) emails.add(v.toLowerCase().trim())
  }
  const attendees = Array.isArray(note.attendees)
    ? (note.attendees as Array<{ email?: unknown }>)
    : []
  for (const a of attendees) addEmail(a?.email)

  const cal = (note.calendar_event ?? null) as {
    invitees?: unknown
    organiser?: unknown
    scheduled_start_time?: unknown
  } | null
  if (cal) {
    const invitees = Array.isArray(cal.invitees) ? (cal.invitees as Array<{ email?: unknown }>) : []
    for (const i of invitees) addEmail(i?.email)
    addEmail(cal.organiser)
  }

  const transcriptRows = Array.isArray(note.transcript)
    ? (note.transcript as Array<{ text?: unknown }>)
    : []
  const transcriptText = transcriptRows
    .map((r) => (typeof r?.text === 'string' ? r.text : ''))
    .filter(Boolean)
    .join('\n')

  return {
    id: typeof note.id === 'string' ? note.id : noteId,
    title: typeof note.title === 'string' && note.title ? note.title : '(untitled note)',
    // scheduled_start_time is the real meeting time; created_at is a fallback.
    startedAt:
      (cal && typeof cal.scheduled_start_time === 'string' ? cal.scheduled_start_time : null) ??
      (typeof note.created_at === 'string' ? note.created_at : null),
    attendeeEmails: [...emails],
    transcriptText,
    summaryMarkdown: typeof note.summary_markdown === 'string' ? note.summary_markdown : null,
  }
}
