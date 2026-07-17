import { registerTool, type Tool } from '@exsto/mcp-tools'
import { reviseDraftText, type ReviseDraftInput, type ReviseDraftResult } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// WP-C flagship — synchronous AI revision. Redrafts the WHOLE document under the
// attorney's instruction and returns the revised markdown for a tracked-changes
// review; it persists a reasoning trace but NO version (the revision becomes
// version n+1 only on accept, via the append-only legal.draft.edit). 'write'
// because it records a reasoning_trace row.
const tool: Tool<ReviseDraftInput, ReviseDraftResult> = {
  name: 'legal.draft.revise',
  description:
    "Draft an AI revision of a document version under the attorney's instruction. Records a reasoning trace and returns the complete revised markdown for a redline review — it does NOT create a version (the attorney accepts it into version n+1 via legal.draft.edit, or discards it).",
  mode: 'write',
  handler: (ctx: ActionContext, input) => reviseDraftText(ctx, input),
}

registerTool(tool)
