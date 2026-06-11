import { registerTool, type Tool } from '@exsto/mcp-tools'
import { requestDraft, type GenerateDraftInput } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// ASYNC ALWAYS (Lesson #2): the tool enqueues a worker job and returns the job
// id; the worker calls Claude, persists the reasoning trace, and submits
// draft.generate. The review screen polls the matter for draft.completed.
const tool: Tool<GenerateDraftInput, { jobId: string }> = {
  name: 'legal.draft.generate',
  description:
    "Enqueue async drafting against the matter's questionnaire + transcript (single-member auto-route only). Returns the worker job id; the draft lands as document_draft + document_version with a reasoning trace.",
  mode: 'write',
  handler: (ctx: ActionContext, input) => requestDraft(ctx, input),
}

registerTool(tool)
