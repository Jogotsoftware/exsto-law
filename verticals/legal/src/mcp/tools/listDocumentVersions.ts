import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listDocumentVersions, type DocumentVersionSummary } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  documentVersionId: string
}

// The full version history of a document (resolved from any of its version ids),
// newest first — backs the review-page "Compare versions" view.
const tool: Tool<Input, { versions: DocumentVersionSummary[] }> = {
  name: 'legal.draft.versions',
  description:
    "List every version of a document (origin, AI regenerations, and manual edits), newest first, with each version's status, timestamp, and how it came to be. Use it to compare two versions of a draft.",
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const versions = await listDocumentVersions(ctx, input.documentVersionId)
    return { versions }
  },
}

registerTool(tool)
