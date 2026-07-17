import { withActionContext, type ActionContext } from '@exsto/substrate'
import type { VoiceViolation } from '../api/emailVoiceChecks.js'

export interface PendingDraftSummary {
  documentVersionId: string
  documentEntityId: string
  matterEntityId: string
  matterNumber: string
  // The matter's client (via client_of → full_name). '' when unresolved or on
  // reads that don't fetch it. WP-C adds the CLIENT column to the review queue.
  clientName: string
  documentKind: string
  versionNumber: number
  status: string
  recordedAt: string
  // MACHINE-COMMS-1 (WP2): 'communication' = an outbound EMAIL draft (entity kind
  // communication_draft, linked via comm_draft_of). Approve = send. The queue and
  // editor branch on this; every other read (runner latest-draft, e-sign picker,
  // mail attachments, /d share) stays draft_of-only and never sees one.
  channel: 'document' | 'communication'
  emailSubject: string | null
  emailToRole: string | null
  // STYLE-FIX-2: the deterministic house-voice check result recorded on this
  // VERSION when it was drafted ([] = clean pass; null = never checked, i.e.
  // document drafts and template merges). The queue card surfaces non-empty
  // flags so the attorney sees them before opening the editor.
  voiceViolations: VoiceViolation[] | null
}

export interface DraftDetail extends PendingDraftSummary {
  // The matter's service key (e.g. 'attorney_letter'), for the reader sub-line
  // "client · service · Open matter". '' when the matter has no service.
  serviceKey: string
  bodyMarkdown: string
  reasoningTrace: Record<string, unknown> | null
  modelIdentity: string | null
  conclusion: string | null
  confidence: number | null
  reviewNotes: string | null
  // AI document review (generation_mode 'ai_review' versions): the reviewed
  // upload's linkage plus the extracted source text and optional redline —
  // both stored as extra content blobs on the memo's action, resolved here by
  // the metadata ids. Null for ordinary drafts.
  aiReview: {
    reviewedDocumentVersionId: string | null
    reviewedDocumentEntityId: string | null
    reviewedOriginalFilename: string | null
    sourceText: string | null
    redlineText: string | null
  } | null
}

export async function listPendingDraftVersions(ctx: ActionContext): Promise<PendingDraftSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
      rel_kind: string
      email_subject: string | null
      email_to_role: string | null
      voice_violations: VoiceViolation[] | null
    }>(
      `SELECT
         dv.id AS version_id,
         dv.document_entity_id,
         r.target_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         (SELECT a2.value #>> '{}'
            FROM relationship rc
            JOIN relationship_kind_definition rkdc ON rkdc.id = rc.relationship_kind_id
            JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = rc.source_entity_id
            JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
            WHERE rc.tenant_id = $1 AND rc.target_entity_id = r.target_entity_id AND rkdc.kind_name = 'client_of'
            ORDER BY a2.valid_from DESC
            LIMIT 1) AS client_name,
         coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at,
         rkd.kind_name AS rel_kind,
         e_doc.metadata->>'email_subject' AS email_subject,
         e_doc.metadata->>'email_to_role' AS email_to_role,
         dv.metadata->'voice_violations' AS voice_violations
       FROM document_version dv
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND rkd.kind_name IN ('draft_of', 'comm_draft_of')
         AND dv.status = 'pending_review'
       ORDER BY dv.recorded_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((row) => ({
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      clientName: row.client_name ?? '',
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      channel:
        row.rel_kind === 'comm_draft_of' ? ('communication' as const) : ('document' as const),
      emailSubject: row.email_subject,
      emailToRole: row.email_to_role,
      voiceViolations: row.voice_violations ?? null,
    }))
  })
}

// The latest draft version per draft document of a matter (one row per draft
// document, any status — the caller decides what to do with rejected /
// revision_requested versions). Used by the mail-attachment picker and by the
// assistant's matter context (which surfaces the status to the attorney).
// Scoped to the matter via draft_of.
export async function listMatterDraftVersions(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<PendingDraftSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
    }>(
      `SELECT DISTINCT ON (dv.document_entity_id)
         dv.id AS version_id,
         dv.document_entity_id,
         r.target_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at
       FROM document_version dv
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND r.target_entity_id = $2
         AND rkd.kind_name = 'draft_of'
       ORDER BY dv.document_entity_id, dv.version_number DESC`,
      [ctx.tenantId, matterEntityId],
    )
    // draft_of-only by design (runner / e-sign / attachment picker safety), so the
    // channel is always 'document' here.
    return res.rows.map((row) => ({
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      clientName: '',
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      channel: 'document' as const,
      emailSubject: null,
      emailToRole: null,
      voiceViolations: null,
    }))
  })
}

export interface DocumentVersionSummary {
  documentVersionId: string
  versionNumber: number
  status: string
  recordedAt: string
  // How this version came to be: the first draft, an AI (re)generation, or a
  // manual attorney edit (document.edit). Drives the compare-version labels.
  source: 'original' | 'generated' | 'edited'
  // The attorney's edit note, when source === 'edited'.
  note: string | null
}

// Every version of ONE document (resolved from any of its version ids), newest
// first — the version history behind the review-page "Compare versions" view.
// Tenant-scoped; source is derived from the version's lineage metadata.
export async function listDocumentVersions(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<DocumentVersionSummary[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      version_number: number
      status: string
      recorded_at: string
      ai_generated: boolean
      edited_from: string | null
      note: string | null
    }>(
      `WITH target AS (
         SELECT document_entity_id FROM document_version
         WHERE tenant_id = $1 AND id = $2
       )
       SELECT dv.id AS version_id,
              dv.version_number,
              dv.status,
              to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at,
              (dv.reasoning_trace_id IS NOT NULL) AS ai_generated,
              dv.metadata->>'edited_from_version_id' AS edited_from,
              dv.metadata->>'note' AS note
       FROM document_version dv
       JOIN target t ON t.document_entity_id = dv.document_entity_id
       WHERE dv.tenant_id = $1
       ORDER BY dv.version_number DESC`,
      [ctx.tenantId, documentVersionId],
    )
    return res.rows.map((row) => ({
      documentVersionId: row.version_id,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      source: row.version_number === 1 ? 'original' : row.edited_from ? 'edited' : 'generated',
      note: row.note,
    }))
  })
}

export interface SharedDraftView extends PendingDraftSummary {
  bodyMarkdown: string
}

// Client-safe projection for the PUBLIC shared-draft view (/d/[versionId]).
// Returns ONLY the document body + identifying metadata — NEVER the internal
// reasoning trace, model identity, confidence, or attorney review notes. Those
// stay on the authenticated attorney path (getDraftVersion / `legal.draft.get`).
// Rejected and revision_requested versions are treated as unavailable so a stale
// share link can't surface a draft the attorney has pulled back.
export async function getSharedDraftVersion(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<SharedDraftView | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
      body: string
    }>(
      `SELECT
         dv.id AS version_id,
         dv.document_entity_id,
         r.target_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at,
         cb.body
       FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND dv.id = $2
         AND rkd.kind_name = 'draft_of'
         AND dv.status NOT IN ('rejected', 'revision_requested')
         -- Defense in depth: AI review memos are internal attorney work product
         -- and must never resolve through the client-safe shared-draft surface,
         -- even by direct version id. (They're also excluded from the list.)
         AND coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') <> 'document_review_memo'
       LIMIT 1`,
      [ctx.tenantId, documentVersionId],
    )
    const row = res.rows[0]
    if (!row) return null
    // draft_of-only by design: a communication draft never resolves through the
    // client-safe share surface, even by direct version id.
    return {
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      clientName: '',
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      channel: 'document' as const,
      emailSubject: null,
      emailToRole: null,
      voiceViolations: null,
      bodyMarkdown: row.body,
    }
  })
}

export async function getDraftVersion(
  ctx: ActionContext,
  documentVersionId: string,
): Promise<DraftDetail | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      document_entity_id: string
      matter_entity_id: string
      matter_number: string
      client_name: string | null
      service_key: string | null
      document_kind: string
      version_number: number
      status: string
      recorded_at: string
      body: string
      reasoning_trace_id: string | null
      model_identity: string | null
      generation_mode: string | null
      review_of_version_id: string | null
      review_of_entity_id: string | null
      review_filename: string | null
      review_source_blob_id: string | null
      review_redline_blob_id: string | null
      rel_kind: string
      email_subject: string | null
      email_to_role: string | null
      voice_violations: VoiceViolation[] | null
    }>(
      `SELECT
         dv.id AS version_id,
         dv.document_entity_id,
         r.target_entity_id AS matter_entity_id,
         e_matter.name AS matter_number,
         (SELECT a2.value #>> '{}'
            FROM relationship rc
            JOIN relationship_kind_definition rkdc ON rkdc.id = rc.relationship_kind_id
            JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = rc.source_entity_id
            JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
            WHERE rc.tenant_id = $1 AND rc.target_entity_id = r.target_entity_id AND rkdc.kind_name = 'client_of'
            ORDER BY a2.valid_from DESC
            LIMIT 1) AS client_name,
         (SELECT a3.value #>> '{}'
            FROM attribute a3
            JOIN attribute_kind_definition akd3 ON akd3.id = a3.attribute_kind_id
            WHERE a3.tenant_id = $1 AND a3.entity_id = r.target_entity_id AND akd3.kind_name = 'service_key'
            ORDER BY a3.valid_from DESC
            LIMIT 1) AS service_key,
         coalesce(e_doc.metadata->>'document_kind', 'operating_agreement') AS document_kind,
         dv.version_number,
         dv.status,
         to_char(dv.recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS recorded_at,
         cb.body,
         dv.metadata->'voice_violations' AS voice_violations,
         dv.reasoning_trace_id,
         dv.metadata->>'model_identity' AS model_identity,
         dv.metadata->>'generation_mode' AS generation_mode,
         dv.metadata->>'review_of_document_version_id' AS review_of_version_id,
         dv.metadata->>'review_of_document_entity_id' AS review_of_entity_id,
         dv.metadata->>'review_original_filename' AS review_filename,
         dv.metadata->>'review_source_blob_id' AS review_source_blob_id,
         dv.metadata->>'review_redline_blob_id' AS review_redline_blob_id,
         rkd.kind_name AS rel_kind,
         e_doc.metadata->>'email_subject' AS email_subject,
         e_doc.metadata->>'email_to_role' AS email_to_role
       FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
       JOIN entity e_doc ON e_doc.id = dv.document_entity_id
       JOIN relationship r ON r.source_entity_id = dv.document_entity_id
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
       JOIN entity e_matter ON e_matter.id = r.target_entity_id
       WHERE dv.tenant_id = $1
         AND dv.id = $2
         AND rkd.kind_name IN ('draft_of', 'comm_draft_of')
         AND (r.valid_to IS NULL OR r.valid_to > now())
       ORDER BY r.valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, documentVersionId],
    )
    const row = res.rows[0]
    if (!row) return null

    let reasoningTrace: Record<string, unknown> | null = null
    let conclusion: string | null = null
    let confidence: number | null = null
    if (row.reasoning_trace_id) {
      const traceRes = await client.query<{
        trace: Record<string, unknown>
        conclusion: string
        confidence: string
      }>(
        `SELECT trace, conclusion, confidence::text AS confidence
         FROM reasoning_trace
         WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, row.reasoning_trace_id],
      )
      const t = traceRes.rows[0]
      if (t) {
        reasoningTrace = t.trace
        conclusion = t.conclusion
        confidence = Number(t.confidence)
      }
    }

    const notesRes = await client.query<{ value: string }>(
      `SELECT a.value #>> '{}' AS value
       FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
       WHERE a.tenant_id = $1
         AND a.entity_id = $2
         AND akd.kind_name = 'document_review_notes'
       ORDER BY a.valid_from DESC
       LIMIT 1`,
      [ctx.tenantId, row.document_entity_id],
    )

    // AI-review linkage: resolve the source/redline blobs the memo's action
    // wrote (tenant-scoped; the metadata ids are the only pointer).
    let aiReview: DraftDetail['aiReview'] = null
    if (row.generation_mode === 'ai_review') {
      const blobIds = [row.review_source_blob_id, row.review_redline_blob_id].filter(
        (x): x is string => !!x,
      )
      const blobs = new Map<string, string>()
      if (blobIds.length > 0) {
        const blobRes = await client.query<{ id: string; body: string }>(
          `SELECT id, body FROM content_blob WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
          [ctx.tenantId, blobIds],
        )
        for (const b of blobRes.rows) blobs.set(b.id, b.body)
      }
      aiReview = {
        reviewedDocumentVersionId: row.review_of_version_id,
        reviewedDocumentEntityId: row.review_of_entity_id,
        reviewedOriginalFilename: row.review_filename,
        sourceText: row.review_source_blob_id
          ? (blobs.get(row.review_source_blob_id) ?? null)
          : null,
        redlineText: row.review_redline_blob_id
          ? (blobs.get(row.review_redline_blob_id) ?? null)
          : null,
      }
    }

    return {
      documentVersionId: row.version_id,
      documentEntityId: row.document_entity_id,
      matterEntityId: row.matter_entity_id,
      matterNumber: row.matter_number,
      clientName: row.client_name ?? '',
      serviceKey: row.service_key ?? '',
      documentKind: row.document_kind,
      versionNumber: row.version_number,
      status: row.status,
      recordedAt: row.recorded_at,
      channel:
        row.rel_kind === 'comm_draft_of' ? ('communication' as const) : ('document' as const),
      emailSubject: row.email_subject,
      emailToRole: row.email_to_role,
      voiceViolations: row.voice_violations ?? null,
      bodyMarkdown: row.body,
      reasoningTrace,
      modelIdentity: row.model_identity,
      conclusion,
      confidence,
      reviewNotes: notesRes.rows[0]?.value ?? null,
      aiReview,
    }
  })
}
