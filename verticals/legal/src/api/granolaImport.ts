// Granola folder → auto-match import (attorney pull flow). Distinct from the
// push/webhook pipeline in granolaIngestion.ts: here the attorney connects
// Granola, picks a folder, the app lists that folder's notes, auto-matches each
// to an existing matter by attendee email, shows a preview, and on confirm pulls
// the transcript and records it via call.ingest. Unmatched notes are surfaced,
// never silently dropped.
//
// Invariants honored: every substrate write goes through submitAction
// (call.ingest); reads are tenant-scoped via withActionContext; the Granola key
// is resolved server-side per tenant by the adapter (never trusted from input).
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  getGranolaNote,
  listGranolaFolders,
  listGranolaNotesInFolder,
  type GranolaFolder,
} from '../adapters/granola.js'

// Re-export the adapter's folder shape so MCP tools / UI can type against the
// vertical's public api surface (@exsto/legal) without reaching into adapters.
export type { GranolaFolder } from '../adapters/granola.js'

// One matched matter, keyed by a client email. Carried in the index and echoed
// back in previews so the UI can show what each note matched to.
export interface MatterMatch {
  matterEntityId: string
  matterNumber: string
  clientName: string
}

export type MatterEmailIndex = Map<string, MatterMatch>

export interface NotePreview {
  noteId: string
  title: string
  date: string | null
  attendeeEmails: string[]
  // The auto-match (null = no client email matched any matter). matchedEmail is
  // the specific attendee email that produced the match, for explainability.
  match: (MatterMatch & { matchedEmail: string }) | null
}

export interface ImportSelection {
  noteId: string
  // Caller-confirmed target. null = import as unmatched (lands in the review
  // queue, per call.ingest), letting the attorney still capture the transcript.
  matterEntityId: string | null
}

export interface ImportResult {
  noteId: string
  status: 'imported' | 'skipped' | 'error'
  matterEntityId: string | null
  error?: string
}

// Pure matcher — no network, no DB, fully unit-testable. Exact, case-insensitive
// email match against the prebuilt index. First matching attendee wins; in a
// legal product a wrong-matter attach is worse than no match, so there is no
// fuzzy fallback (mirrors granolaIngestion's strict stance).
export function matchNoteToMatter(
  attendeeEmails: string[],
  matterIndex: MatterEmailIndex,
): (MatterMatch & { matchedEmail: string }) | null {
  for (const raw of attendeeEmails) {
    if (!raw) continue
    const email = raw.toLowerCase().trim()
    const hit = matterIndex.get(email)
    if (hit) return { ...hit, matchedEmail: email }
  }
  return null
}

// Build the tenant's (client email → matter) index once per preview so we don't
// re-query per note. Same relationship vocabulary as listMatters/matchMatterForCall:
// client_contact --client_of--> matter, with the contact's `email` + `full_name`
// attributes read at current state (latest valid_from). A client with several
// matters yields one index entry per email pointing at the most recent matter.
export async function buildMatterEmailIndex(ctx: ActionContext): Promise<MatterEmailIndex> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      email: string | null
      full_name: string | null
      matter_entity_id: string
      matter_number: string
      created_at: string
    }>(
      `WITH attrs AS (
         SELECT DISTINCT ON (a.entity_id, akd.kind_name)
           a.entity_id, akd.kind_name, a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         WHERE a.tenant_id = $1
         ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
       )
       SELECT
         lower(ea.value #>> '{}') AS email,
         na.value #>> '{}'        AS full_name,
         e.id                     AS matter_entity_id,
         e.name                   AS matter_number,
         to_char(e.created_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS created_at
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'matter'
       JOIN relationship r
         ON r.target_entity_id = e.id AND r.tenant_id = e.tenant_id
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'client_of'
       JOIN attrs ea ON ea.entity_id = r.source_entity_id AND ea.kind_name = 'email'
       LEFT JOIN attrs na ON na.entity_id = r.source_entity_id AND na.kind_name = 'full_name'
       WHERE e.tenant_id = $1
         AND e.status = 'active'
         AND (r.valid_to IS NULL OR r.valid_to > now())
         AND ea.value #>> '{}' IS NOT NULL
       ORDER BY e.created_at DESC`,
      [ctx.tenantId],
    )

    const index: MatterEmailIndex = new Map()
    for (const row of res.rows) {
      const email = row.email?.trim()
      if (!email) continue
      // Rows are newest-first; keep the first (most recent) matter per email.
      if (index.has(email)) continue
      index.set(email, {
        matterEntityId: row.matter_entity_id,
        matterNumber: row.matter_number,
        clientName: row.full_name ?? '',
      })
    }
    return index
  })
}

// List the connected Granola account's folders for the picker.
export async function listImportFolders(ctx: ActionContext): Promise<GranolaFolder[]> {
  return listGranolaFolders(ctx.tenantId, ctx.actorId)
}

// Granola allows ~5 rps / 25 burst; firing a getNote per note in parallel would
// trip 429s. Run a small fixed-concurrency worker pool instead of Promise.all.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      const item = items[i]
      // noUncheckedIndexedAccess widens items[i] to T|undefined; i<length above
      // guarantees presence, but narrow explicitly to satisfy the checker.
      if (item === undefined) return
      results[i] = await fn(item)
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// Scan a folder: list its notes, pull each note's metadata + attendees (WITHOUT
// transcript, to stay light), build the matter index once, and auto-match.
// A note that can't be fetched (e.g. a transient 404 on a brand-new meeting) is
// surfaced with an empty attendee set and no match rather than failing the scan.
export async function previewFolderImport(
  ctx: ActionContext,
  folderId: string,
): Promise<NotePreview[]> {
  const [summaries, index] = await Promise.all([
    listGranolaNotesInFolder(ctx.tenantId, folderId, ctx.actorId),
    buildMatterEmailIndex(ctx),
  ])

  return mapWithConcurrency(summaries, 4, async (summary) => {
    try {
      const note = await getGranolaNote(
        ctx.tenantId,
        summary.id,
        { transcript: false },
        ctx.actorId,
      )
      return {
        noteId: summary.id,
        title: note.title || summary.title,
        date: note.startedAt ?? summary.createdAt,
        attendeeEmails: note.attendeeEmails,
        match: matchNoteToMatter(note.attendeeEmails, index),
      } satisfies NotePreview
    } catch {
      // Defensive: a single unfetchable note must not sink the whole preview.
      return {
        noteId: summary.id,
        title: summary.title,
        date: summary.createdAt,
        attendeeEmails: [],
        match: null,
      } satisfies NotePreview
    }
  })
}

// Import the selected notes: pull each WITH transcript, then record via
// call.ingest (the existing recording seam — idempotent on the note id, routes
// null-matter notes to the review queue). Sequential to respect the rate limit
// and to keep substrate writes ordered. One failing note doesn't abort the rest.
export async function importNotes(
  ctx: ActionContext,
  selections: ImportSelection[],
): Promise<ImportResult[]> {
  const results: ImportResult[] = []
  for (const sel of selections) {
    try {
      const note = await getGranolaNote(ctx.tenantId, sel.noteId, { transcript: true }, ctx.actorId)
      if (!note.transcriptText) {
        // No transcript yet (summary-only / brand-new note): skip, don't error.
        results.push({ noteId: sel.noteId, status: 'skipped', matterEntityId: sel.matterEntityId })
        continue
      }
      await submitAction(ctx, {
        actionKindName: 'call.ingest',
        intentKind: 'automatic_sync',
        payload: {
          granola_call_id: sel.noteId,
          matter_entity_id: sel.matterEntityId,
          started_at: note.startedAt,
          ended_at: null,
          duration_seconds: null,
          transcript_text: note.transcriptText,
          transcript_source: 'granola',
          notes: note.summaryMarkdown ? { summary_markdown: note.summaryMarkdown } : null,
          attendee_emails: note.attendeeEmails,
          raw_event_log_id: null,
        },
      })
      results.push({ noteId: sel.noteId, status: 'imported', matterEntityId: sel.matterEntityId })
    } catch (e) {
      results.push({
        noteId: sel.noteId,
        status: 'error',
        matterEntityId: sel.matterEntityId,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return results
}
