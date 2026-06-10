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
    actionKindName: 'legal.draft.approve',
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
    actionKindName: 'legal.draft.request_revision',
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
    actionKindName: 'legal.draft.reject',
    intentKind: 'enforcement',
    payload: {
      document_version_id: input.documentVersionId,
      review_notes: input.reviewNotes,
    },
  })
}
