import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  approveDraft,
  rejectDraft,
  requestDraftRevision,
  editDraft,
  type DraftReviewInput,
  type DraftEditInput,
} from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const approveTool: Tool<DraftReviewInput, ActionResult> = {
  name: 'legal.draft.approve',
  description: 'Attorney approval of a draft document version.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => approveDraft(ctx, input),
}

const requestRevisionTool: Tool<DraftReviewInput, ActionResult> = {
  name: 'legal.draft.request_revision',
  description: 'Attorney sends a draft back for revision; review notes required.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => requestDraftRevision(ctx, input),
}

const rejectTool: Tool<DraftReviewInput, ActionResult> = {
  name: 'legal.draft.reject',
  description: 'Attorney rejects a draft outright.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => rejectDraft(ctx, input),
}

const editTool: Tool<DraftEditInput, ActionResult> = {
  name: 'legal.draft.edit',
  description:
    'Attorney inline edit of a draft: saves the revised document markdown as a NEW version (append-only — the prior version is preserved). The new version inherits the source status. Returns the new documentVersionId in its effects.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => editDraft(ctx, input),
}

registerTool(approveTool)
registerTool(requestRevisionTool)
registerTool(rejectTool)
registerTool(editTool)
