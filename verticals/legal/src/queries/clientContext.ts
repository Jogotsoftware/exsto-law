// MACHINE-COMMS-1 (WP1) — CLIENT MEMORY: one deterministic, capped assembly of
// everything the firm knows about a client. On this append-only substrate nothing
// was ever deleted; this is the query nobody had written. Archived ≠ invisible:
// archived matters are finished work, and finished work is exactly what informs
// the next email/draft — so matters are included REGARDLESS of entity status.
//
// Consumption is explicit, never silent (WP1.4): the assistant loads this when
// working on a client/matter; email_generation always uses it; document_generation
// (ai_draft) only via the opt-in use_client_context flag; template_merge never.
//
// Compact by design — the output is prompt-injected. Most-recent-first, stable
// ordering, hard character budget (formatClientContext truncates with a marker,
// never silently).
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { getClient } from './client.js'
import { listNotesForEntity, type NoteSummary } from './notes.js'

export interface ClientContextMatter {
  matterEntityId: string
  matterNumber: string
  serviceKey: string
  matterStatus: string
  archived: boolean
  openedAt: string
  // Key intake facts — the questionnaire answers, capped to the first few pairs.
  intakeFacts: Record<string, unknown> | null
  // Released documents: what the attorney APPROVED (titles/kinds only, no bodies).
  releasedDocuments: Array<{ documentKind: string; versionNumber: number; approvedAt: string }>
  notes: NoteSummary[]
}

export interface ClientContextTranscript {
  transcriptEntityId: string
  matterNumber: string | null
  createdAt: string
  excerpt: string
}

export interface ClientContextMessage {
  subject: string
  direction: string | null
  preview: string
  at: string | null
}

export interface ClientContext {
  clientEntityId: string
  name: string
  contacts: Array<{ fullName: string; email: string }>
  matters: ClientContextMatter[]
  clientNotes: NoteSummary[]
  transcripts: ClientContextTranscript[]
  recentMessages: ClientContextMessage[]
}

const INTAKE_FACT_CAP = 8
const TRANSCRIPT_EXCERPT_CHARS = 240
const MESSAGE_CAP = 8
// Most-recent N matters assembled in detail; older ones only truncate out of the
// formatted budget anyway, so bounding the assembly keeps the query count flat
// for a client with a long history.
const MATTER_CAP = 20
export const CLIENT_CONTEXT_DEFAULT_BUDGET = 12_000

// The client's matter ids with THIS file's semantics — INCLUDING archived
// matters (archived ≠ invisible), newest first, same MATTER_CAP as the full
// assembly — without the heavy per-matter loading getClientContext does.
// Exported for clientBriefEngine's computeClientWatermark (Brief WP3): the
// Client Brief staleness key must range over the SAME matter set the evidence
// bundle assembles from, and getClient()'s active-only matter list is NOT that
// set (a client whose matters are all archived would read as having no history
// at all — found live on a real archived-matter client).
export async function listClientContextMatterIds(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<string[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ matter_id: string }>(
      `SELECT e.id AS matter_id
         FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'matter'
         JOIN relationship r ON r.source_entity_id = e.id AND r.target_entity_id = $2
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
              AND rkd.kind_name = 'matter_of'
        WHERE e.tenant_id = $1
        ORDER BY e.created_at DESC
        LIMIT ${MATTER_CAP}`,
      [ctx.tenantId, clientEntityId],
    )
    return res.rows.map((row) => row.matter_id)
  })
}

export async function getClientContext(
  ctx: ActionContext,
  clientEntityId: string,
): Promise<ClientContext | null> {
  const profile = await getClient(ctx, clientEntityId)
  if (!profile) return null

  return withActionContext(ctx, async (client) => {
    // Matters INCLUDING archived (the deliberate difference from getClient).
    const mattersRes = await client.query<{
      matter_id: string
      matter_number: string
      service_key: string | null
      matter_status: string | null
      entity_status: string
      created_at: Date
      intake: Record<string, unknown> | null
    }>(
      `SELECT e.id AS matter_id, e.name AS matter_number, e.status AS entity_status,
              e.created_at,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND ak.kind_name = 'service_key' ORDER BY a.valid_from DESC LIMIT 1) AS service_key,
              (SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND ak.kind_name = 'matter_status' ORDER BY a.valid_from DESC LIMIT 1) AS matter_status,
              (SELECT a.value FROM attribute a
                 JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                 JOIN relationship rr ON rr.source_entity_id = a.entity_id
                 JOIN relationship_kind_definition rrk ON rrk.id = rr.relationship_kind_id
                WHERE a.tenant_id = e.tenant_id AND rr.target_entity_id = e.id
                  AND rrk.kind_name = 'response_of' AND ak.kind_name = 'questionnaire_responses'
                ORDER BY a.valid_from DESC LIMIT 1) AS intake
         FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'matter'
         JOIN relationship r ON r.source_entity_id = e.id AND r.target_entity_id = $2
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
              AND rkd.kind_name = 'matter_of'
        WHERE e.tenant_id = $1
        ORDER BY e.created_at DESC
        LIMIT ${MATTER_CAP}`,
      [ctx.tenantId, clientEntityId],
    )
    const matterIds = mattersRes.rows.map((m) => m.matter_id)

    // Released (approved) document versions per matter — latest approved per document.
    const docsRes = matterIds.length
      ? await client.query<{
          matter_id: string
          document_kind: string
          version_number: number
          recorded_at: string
        }>(
          `SELECT DISTINCT ON (dv.document_entity_id)
                  r.target_entity_id AS matter_id,
                  coalesce(e_doc.metadata->>'document_kind', 'document') AS document_kind,
                  dv.version_number,
                  to_char(dv.recorded_at, 'YYYY-MM-DD') AS recorded_at
             FROM document_version dv
             JOIN entity e_doc ON e_doc.id = dv.document_entity_id
             JOIN relationship r ON r.source_entity_id = dv.document_entity_id
             JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
                  AND rkd.kind_name = 'draft_of'
            WHERE dv.tenant_id = $1 AND dv.status = 'approved'
              AND r.target_entity_id = ANY($2::uuid[])
            ORDER BY dv.document_entity_id, dv.version_number DESC`,
          [ctx.tenantId, matterIds],
        )
      : { rows: [] as Array<never> }

    // Transcripts: direct transcript_of_client / transcript_of_matter links first,
    // plus the legacy two-hop (transcript_of → call_of) so pre-backfill data still
    // assembles. De-duped by transcript id.
    const transcriptsRes = await client.query<{
      transcript_id: string
      matter_number: string | null
      created_at: string
      excerpt: string | null
    }>(
      `WITH direct_client AS (
         SELECT r.source_entity_id AS tid, NULL::uuid AS matter_id
           FROM relationship r
           JOIN relationship_kind_definition k ON k.id = r.relationship_kind_id
          WHERE r.tenant_id = $1 AND k.kind_name = 'transcript_of_client' AND r.target_entity_id = $2
       ),
       direct_matter AS (
         SELECT r.source_entity_id AS tid, r.target_entity_id AS matter_id
           FROM relationship r
           JOIN relationship_kind_definition k ON k.id = r.relationship_kind_id
          WHERE r.tenant_id = $1 AND k.kind_name = 'transcript_of_matter'
            AND r.target_entity_id = ANY($3::uuid[])
       ),
       two_hop AS (
         SELECT t.source_entity_id AS tid, c.target_entity_id AS matter_id
           FROM relationship t
           JOIN relationship_kind_definition tk ON tk.id = t.relationship_kind_id
                AND tk.kind_name = 'transcript_of'
           JOIN relationship c ON c.source_entity_id = t.target_entity_id
           JOIN relationship_kind_definition ck ON ck.id = c.relationship_kind_id
                AND ck.kind_name = 'call_of'
          WHERE t.tenant_id = $1 AND c.target_entity_id = ANY($3::uuid[])
       ),
       all_links AS (
         SELECT DISTINCT ON (tid) tid, matter_id
           FROM (SELECT * FROM direct_matter UNION ALL SELECT * FROM two_hop
                 UNION ALL SELECT * FROM direct_client) u
          ORDER BY tid, matter_id NULLS LAST
       )
       SELECT e.id AS transcript_id,
              m.name AS matter_number,
              to_char(e.created_at, 'YYYY-MM-DD') AS created_at,
              left((SELECT a.value #>> '{}' FROM attribute a
                 JOIN attribute_kind_definition ak ON ak.id = a.attribute_kind_id
                WHERE a.tenant_id = e.tenant_id AND a.entity_id = e.id
                  AND ak.kind_name = 'transcript_text'
                ORDER BY a.valid_from DESC LIMIT 1), ${TRANSCRIPT_EXCERPT_CHARS}) AS excerpt
         FROM all_links l
         JOIN entity e ON e.id = l.tid
         LEFT JOIN entity m ON m.id = l.matter_id
        WHERE e.tenant_id = $1
        ORDER BY e.created_at DESC`,
      [ctx.tenantId, clientEntityId, matterIds],
    )

    // Recent messages across the client's matters (ingested record, newest first).
    const messagesRes = matterIds.length
      ? await client.query<{
          subject: string | null
          direction: string | null
          preview: string | null
          at: string | null
        }>(
          `SELECT t.subject, m.payload->>'direction' AS direction, m.body_preview AS preview,
                  to_char(m.occurred_at, 'YYYY-MM-DD"T"HH24:MI') AS at
             FROM communication_thread t
             JOIN communication_message m ON m.tenant_id = t.tenant_id AND m.thread_id = t.id
            WHERE t.tenant_id = $1 AND t.related_entity_ids && $2::uuid[]
            ORDER BY m.occurred_at DESC
            LIMIT ${MESSAGE_CAP}`,
          [ctx.tenantId, matterIds],
        )
      : { rows: [] as Array<never> }

    const docsByMatter = new Map<
      string,
      Array<{ documentKind: string; versionNumber: number; approvedAt: string }>
    >()
    for (const d of docsRes.rows as Array<{
      matter_id: string
      document_kind: string
      version_number: number
      recorded_at: string
    }>) {
      const list = docsByMatter.get(d.matter_id) ?? []
      list.push({
        documentKind: d.document_kind,
        versionNumber: d.version_number,
        approvedAt: d.recorded_at,
      })
      docsByMatter.set(d.matter_id, list)
    }

    const clientNotes = await listNotesForEntity(ctx, clientEntityId)
    const matters: ClientContextMatter[] = []
    for (const m of mattersRes.rows) {
      matters.push({
        matterEntityId: m.matter_id,
        matterNumber: m.matter_number,
        serviceKey: m.service_key ?? '',
        matterStatus: m.matter_status ?? 'unknown',
        archived: m.entity_status === 'archived',
        openedAt: m.created_at.toISOString().slice(0, 10),
        intakeFacts: capIntakeFacts(m.intake),
        releasedDocuments: docsByMatter.get(m.matter_id) ?? [],
        notes: await listNotesForEntity(ctx, m.matter_id),
      })
    }

    return {
      clientEntityId,
      name: profile.name,
      contacts: profile.contacts.map((c) => ({ fullName: c.fullName, email: c.email })),
      matters,
      clientNotes,
      transcripts: transcriptsRes.rows.map((t) => ({
        transcriptEntityId: t.transcript_id,
        matterNumber: t.matter_number,
        createdAt: t.created_at,
        excerpt: (t.excerpt ?? '').trim(),
      })),
      recentMessages: (
        messagesRes.rows as Array<{
          subject: string | null
          direction: string | null
          preview: string | null
          at: string | null
        }>
      ).map((r) => ({
        subject: r.subject ?? '(no subject)',
        direction: r.direction,
        preview: r.preview ?? '',
        at: r.at,
      })),
    }
  })
}

// First N intake answers, deterministically (sorted keys), values stringified short.
function capIntakeFacts(intake: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!intake || typeof intake !== 'object') return null
  const keys = Object.keys(intake).sort().slice(0, INTAKE_FACT_CAP)
  if (keys.length === 0) return null
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    const v = intake[k]
    out[k] = typeof v === 'string' && v.length > 160 ? `${v.slice(0, 160)}…` : v
  }
  return out
}

// Render the context as the compact prompt block every consumer injects. The
// content is CLIENT/HISTORY DATA, not instructions — consumers must delimit it
// (the standard untrusted-data framing) when placing it in a prompt. Hard budget:
// the output never exceeds maxChars; truncation is marked, never silent.
export function formatClientContext(
  c: ClientContext,
  maxChars: number = CLIENT_CONTEXT_DEFAULT_BUDGET,
): string {
  const lines: string[] = []
  lines.push(`CLIENT: ${c.name}`)
  if (c.contacts.length) {
    lines.push(`Contacts: ${c.contacts.map((x) => `${x.fullName} <${x.email}>`).join('; ')}`)
  }
  for (const m of c.matters) {
    lines.push('')
    lines.push(
      `MATTER ${m.matterNumber} — service: ${m.serviceKey || '(none)'}; status: ${m.matterStatus}` +
        `${m.archived ? '; ARCHIVED (completed work)' : ''}; opened ${m.openedAt}`,
    )
    if (m.intakeFacts) {
      lines.push(
        `  Intake facts: ${Object.entries(m.intakeFacts)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join('; ')}`,
      )
    }
    for (const d of m.releasedDocuments) {
      lines.push(`  Released document: ${d.documentKind} v${d.versionNumber} (${d.approvedAt})`)
    }
    for (const n of m.notes) {
      lines.push(`  Note (${n.source}, ${n.createdAt.slice(0, 10)}): ${oneLine(n.body, 300)}`)
    }
  }
  if (c.clientNotes.length) {
    lines.push('')
    for (const n of c.clientNotes) {
      lines.push(`CLIENT NOTE (${n.source}, ${n.createdAt.slice(0, 10)}): ${oneLine(n.body, 300)}`)
    }
  }
  if (c.transcripts.length) {
    lines.push('')
    for (const t of c.transcripts) {
      lines.push(
        `TRANSCRIPT ${t.createdAt}${t.matterNumber ? ` (matter ${t.matterNumber})` : ''}: ${oneLine(t.excerpt, TRANSCRIPT_EXCERPT_CHARS)}`,
      )
    }
  }
  if (c.recentMessages.length) {
    lines.push('')
    for (const msg of c.recentMessages) {
      lines.push(
        `MESSAGE ${msg.at ?? ''} [${msg.direction ?? '?'}] ${msg.subject}: ${oneLine(msg.preview, 160)}`,
      )
    }
  }
  const text = lines.join('\n')
  if (text.length <= maxChars) return text
  return `${text.slice(0, Math.max(0, maxChars - 60))}\n…[client context truncated at ${maxChars} chars]`
}

// Exported so other assemblers over this same client/matter material (e.g.
// briefEvidence.ts's Client Brief evidence) collapse/cap one-line excerpts the
// SAME way formatClientContext does — one implementation, not a fork.
export function oneLine(s: string, cap: number): string {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat
}
