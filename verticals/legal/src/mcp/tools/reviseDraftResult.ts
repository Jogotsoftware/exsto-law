import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getDraftRevisionResult, type DraftRevisionJobResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  requestId: string
}

// EDITOR-FIX-1 (item 1) — poll read for the async Edit-with-AI revision. Returns
// the outcome for a requestId, or null while the worker is still generating. The
// editor polls this after legal.draft.revise.request (BriefButton pattern:
// interval + honest "Working…", button disabled while pending); a failed job
// returns { status: 'failed', error } so the rail can show it with a Retry.
const tool: Tool<Input, { result: DraftRevisionJobResult | null }> = {
  name: 'legal.draft.revise.result',
  description:
    'Read the outcome of an enqueued AI revision by its requestId. Null while still running; { status: "completed", revisedMarkdown, … } on success; { status: "failed", error } on failure.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const result = await getDraftRevisionResult(ctx, input.requestId)
    return { result }
  },
}

registerTool(tool)
