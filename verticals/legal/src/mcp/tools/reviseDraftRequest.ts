import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  enqueueDraftRevision,
  type EnqueueDraftRevisionResult,
  type ReviseDraftInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// EDITOR-FIX-1 (item 1) — the async door for Edit-with-AI. Enqueues a
// legal.draft.revise.run worker_job and returns a request id immediately; the
// editor polls legal.draft.revise.result. 'write' because it records a worker_job
// (and, when it runs, a reasoning_trace). This SUPERSEDES the synchronous
// legal.draft.revise for the editor — that tool ran the Claude call in-request and
// 504'd the gateway when the model was slow.
const tool: Tool<ReviseDraftInput, EnqueueDraftRevisionResult> = {
  name: 'legal.draft.revise.request',
  description:
    "Enqueue an AI revision of a document version under the attorney's instruction, OFF the request (model calls never block the gateway). Returns { jobId, requestId }; poll legal.draft.revise.result with the requestId for the revised markdown. Records a reasoning trace but NO version — the attorney accepts the proposal into version n+1 via legal.draft.edit, or discards it.",
  mode: 'write',
  handler: (ctx: ActionContext, input) => enqueueDraftRevision(ctx, input),
}

registerTool(tool)
