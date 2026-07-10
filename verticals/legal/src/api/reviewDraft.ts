import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'
import { getDraftVersion } from '../queries/drafts.js'
import { sendDraftLinkEmail } from './email.js'

export interface DraftReviewInput {
  documentVersionId: string
  reviewNotes?: string
}

// Public base for the client-facing draft link (`/d/<versionId>`), server side —
// mirrors clientRequests.ts. The browser builds the same URL via shareUrlFor().
const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

export async function approveDraft(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'draft.approve',
    intentKind: 'enforcement',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}

export interface ApproveDocumentResult {
  approved: boolean
  sent: boolean
}

// Contract W — approve a document version and (optionally) send the client the draft
// link in ONE call. Approval flows through draft.approve (which accrues the document
// fee — WP1 — and advances the workflow). When `send` is set, the client gets the
// Pacheco Law email with the public `/d/<versionId>` link, recorded through the
// existing mail path. `send` failures do NOT roll back the approval (the fee/advance
// already committed); they surface so the caller can retry the send alone.
export async function approveDocument(
  ctx: ActionContext,
  input: { documentVersionId: string; send: boolean; reviewNotes?: string },
): Promise<ApproveDocumentResult> {
  if (!input.documentVersionId?.trim()) throw new Error('documentVersionId is required.')
  await approveDraft(ctx, {
    documentVersionId: input.documentVersionId,
    reviewNotes: input.reviewNotes,
  })
  if (!input.send) return { approved: true, sent: false }

  const draft = await getDraftVersion(ctx, input.documentVersionId)
  if (!draft)
    throw new Error(`Approved, but draft version not found to send: ${input.documentVersionId}`)
  await sendDraftLinkEmail(ctx, {
    matterEntityId: draft.matterEntityId,
    documentVersionId: input.documentVersionId,
    shareUrl: `${BASE_URL}/d/${input.documentVersionId}`,
  })
  return { approved: true, sent: true }
}

export async function requestDraftRevision(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  if (!input.reviewNotes) {
    throw new Error('Review notes are required to request a revision.')
  }
  return submitAction(ctx, {
    actionKindName: 'draft.request_revision',
    intentKind: 'correction',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}

export async function rejectDraft(
  ctx: ActionContext,
  input: DraftReviewInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'draft.reject',
    intentKind: 'enforcement',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}

export interface DraftEditInput {
  documentVersionId: string
  documentMarkdown: string
  // Optional one-liner describing the change; stored on the new version's metadata.
  note?: string
}

// Attorney inline edit: saves the revised markdown as a NEW document_version
// (the document.edit handler is append-only — invariant 14, never an in-place
// overwrite — and the new version inherits the source's status). Lets a reviewer
// fix a clause or a name directly instead of round-tripping through a full
// regenerate. intent is `correction`: the attorney is correcting the document.
export async function editDraft(ctx: ActionContext, input: DraftEditInput): Promise<ActionResult> {
  if (!input.documentMarkdown.trim()) {
    throw new Error('The document cannot be empty.')
  }
  return submitAction(ctx, {
    actionKindName: 'document.edit',
    intentKind: 'correction',
    payload: {
      document_version_id: input.documentVersionId,
      document_markdown: input.documentMarkdown,
      note: input.note?.trim() || undefined,
    },
  })
}
