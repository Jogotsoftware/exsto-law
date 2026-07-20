// FB-H — the get_attention_feed ClientTool. READ-ONLY, and registered on EVERY
// attorney turn (global included) so an unscoped "what's most pressing?" / "check
// my inbox" / "what have I missed?" gets a REAL ranked answer, not a model guess.
// The feed itself is deterministic code (queries/attentionFeed.ts); this tool is
// the thin chat adapter over it. It NEVER writes — it hands the model the ranked
// items (each with a plain `why` and a clickable deepLink) to answer from. The
// paired ACT tools (compose_email to reply, the review/e-sign launchers) stay
// scope-gated as before; this WP adds no write tools.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { getAttentionFeed, type AttentionItem } from '../queries/attentionFeed.js'

// How many items the tool hands back on one call — enough to triage a day
// without flooding the reply.
const TOOL_FEED_LIMIT = 15

const GET_ATTENTION_FEED_TOOL_DEF = {
  name: 'get_attention_feed',
  description:
    "Read the firm's ranked ATTENTION FEED — the attorney's most pressing items right now, computed deterministically from real firm data: overdue and due-soon tasks, client messages awaiting a reply (inbox), drafts waiting in the review queue, envelopes out unsigned, invoices unpaid, matters with no recent activity, and workflows stuck on a step. READ-ONLY: it never changes anything. Call it whenever the attorney asks what is most pressing, what to work on, to check their inbox, what is overdue, or what may have slipped through the cracks. Each item comes with a plain one-sentence reason (`why`) and a clickable in-app link (`deepLink`): answer by citing the reason in your own words and offering the link to act. Do NOT invent items or deadlines — report only what the feed returns, and if it is empty, say plainly that nothing is pressing.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

// The read-back the model receives: a ranked, bulleted list, each line carrying
// the why + the deepLink so the model can cite the reason and offer the link.
// Empty feed is an explicit, honest "nothing pressing" — never blurred.
export function renderAttentionForModel(items: AttentionItem[]): string {
  if (items.length === 0) {
    return 'The attention feed is empty — nothing is pressing right now. Tell the attorney that plainly; do not invent items.'
  }
  const lines = items.map((it) => `- [${it.kind}] ${it.why} (open: ${it.deepLink})`)
  return (
    `The firm's most pressing items right now, most pressing first. Cite the reason in your own words and offer the link to act — do not paste this list verbatim:\n` +
    lines.join('\n')
  )
}

// Injectable seam (mirrors GetBriefToolDeps) so the unit test pins the read-back
// with a plain fake — no DB.
export interface AttentionFeedToolDeps {
  getAttentionFeed: (ctx: ActionContext) => Promise<AttentionItem[]>
}

const DEFAULT_DEPS: AttentionFeedToolDeps = {
  getAttentionFeed: (ctx) => getAttentionFeed(ctx, { maxItems: TOOL_FEED_LIMIT }),
}

export function buildAttentionFeedTool(
  ctx: ActionContext,
  deps: AttentionFeedToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: GET_ATTENTION_FEED_TOOL_DEF,
    name: 'get_attention_feed',
    run: async () => {
      const items = await deps.getAttentionFeed(ctx)
      return renderAttentionForModel(items)
    },
  }
}
