import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface DraftReviewInput {
  documentVersionId: string
  reviewNotes?: string
}

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
