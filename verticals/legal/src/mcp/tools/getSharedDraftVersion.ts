import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getSharedDraftVersion,
  verifyDraftLinkToken,
  resolveClientMatterIds,
  type SharedDraftView,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'
import { withActionContext } from '@exsto/substrate'

interface Input {
  documentVersionId: string
  /** Signed share token (public door). */
  token?: string
  /** Stamped by the AUTHED portal route from the session (portal door). */
  clientContactId?: string
  /** Stamped by the ATTORNEY route (session-verified); stripped on the public route. */
  __attorneySession?: boolean
}

// Client view of a shared draft (/d/[versionId]). PORTAL-1 (WP2) closed the
// durable-public capability URL: the body is served only through
//   • the TOKEN door — a short-lived signed share token minted when the firm
//     emails the link (sendDraftLinkEmail), or
//   • the PORTAL door — the authed client session, scoped to the client's own
//     matters (the route stamps clientContactId; it is never body-trusted on
//     the public route, which strips it), or
//   • the ATTORNEY door — the attorney MCP route (session-gated) for internal
//     preview links.
// Returns ONLY the client-safe projection — never reasoning/model/review notes.
const tool: Tool<Input, { draft: SharedDraftView | null }> = {
  name: 'legal.draft.get_shared',
  description:
    'Fetch the client-safe body + metadata of a shared draft document version (requires a signed share token on the public door, or the client portal session).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => {
    if (input.clientContactId) {
      // Portal door: the version must hang off one of THIS client's matters.
      const matterIds = await resolveClientMatterIds(ctx.tenantId, input.clientContactId)
      const ok = await withActionContext(ctx, async (client) => {
        if (matterIds.length === 0) return false
        const res = await client.query<{ id: string }>(
          `SELECT dv.id
           FROM document_version dv
           JOIN relationship r ON r.source_entity_id = dv.document_entity_id
           JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
           WHERE dv.id = $1 AND dv.tenant_id = $2
             AND rkd.kind_name = 'draft_of'
             AND r.target_entity_id = ANY($3::uuid[])
           LIMIT 1`,
          [input.documentVersionId, ctx.tenantId, matterIds],
        )
        return res.rows.length > 0
      })
      // Same shape as "not found" — no oracle for another client's document.
      if (!ok) return { draft: null }
    } else if (input.__attorneySession !== true) {
      const tok = verifyDraftLinkToken(input.token)
      if (tok.documentVersionId !== input.documentVersionId || tok.tenantId !== ctx.tenantId) {
        throw new Error('This link is invalid.')
      }
    }
    const draft = await getSharedDraftVersion(ctx, input.documentVersionId)
    return { draft }
  },
}

registerTool(tool)
