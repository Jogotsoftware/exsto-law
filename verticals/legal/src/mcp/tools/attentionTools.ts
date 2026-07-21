import { registerTool, type Tool } from '@exsto/mcp-tools'
import { getAttentionFeed, type AttentionItem } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// FB-H — read the ranked attention feed for the current tenant. Backs the
// attorney home "Attention" card (and any other read-only surface). Attorney-only
// (deliberately NOT in the client-portal allowlist): it exposes cross-matter firm
// state. `limit` caps the returned items (the home card asks for ~6).
const tool: Tool<{ limit?: number }, { items: AttentionItem[] }> = {
  name: 'legal.attention.feed',
  description:
    "The firm's attention feed — INBOUND client events that need the attorney (client messages awaiting a reply, portal + email inbox), each with a plain reason and an in-app link. Read-only.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'number', description: 'Max items to return (default 15, cap 50).' },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const limit =
      typeof input?.limit === 'number' && input.limit > 0 ? Math.min(input.limit, 50) : 15
    const items = await getAttentionFeed(ctx, { maxItems: limit })
    return { items }
  },
}

registerTool(tool)
