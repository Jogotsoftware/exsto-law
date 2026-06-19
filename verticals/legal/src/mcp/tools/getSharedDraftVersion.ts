import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getSharedDraftVersion, type SharedDraftView } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

interface Input {
  documentVersionId: string
}

// PUBLIC, unauthenticated client view of a shared draft (/d/[versionId]).
// Returns ONLY the client-safe projection — document body + identifying metadata,
// never the internal reasoning trace, model identity, confidence, or review notes.
// The full-detail `legal.draft.get` is attorney-only and is NOT on the public
// client allowlist (see clientPolicy.ts).
const tool: Tool<Input, { draft: SharedDraftView | null }> = {
  name: 'legal.draft.get_shared',
  description:
    'Fetch the client-safe body + metadata of a shared draft document version (no internal reasoning/model/review notes).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    const draft = await getSharedDraftVersion(ctx, input.documentVersionId)
    return { draft }
  },
}

registerTool(tool)
