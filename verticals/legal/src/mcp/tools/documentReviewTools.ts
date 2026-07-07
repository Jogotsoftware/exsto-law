import { registerTool, type Tool } from '@exsto/mcp-tools'
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { requestDocumentReview, getUploadedDocumentObject, getMatter } from '../../index.js'

// Manual (re)run of the AI document review for one uploaded matter document —
// the attorney's recovery story for a dead-lettered job and the "tweak the
// prompt, run it again with focus notes" loop. Attorney-only (NOT in the
// client-portal allowlist; clientPolicy.ts is default-deny). The document must
// be an upload of THIS matter (same document_of guard the download route uses).
const reviewRunTool: Tool<
  { matterEntityId: string; documentVersionId: string; guidance?: string },
  { jobId: string }
> = {
  name: 'legal.document.review.run',
  description:
    'Enqueue an AI review of one uploaded matter document (attorney-triggered). Optional guidance focuses this run (e.g. "check the indemnity cap"). The memo lands in the review queue; the attorney email fires on completion.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    // Matter-scoped ownership check (document_of) + filename in one read.
    const object = await getUploadedDocumentObject(
      ctx,
      input.matterEntityId,
      input.documentVersionId,
    )
    if (!object) {
      throw new Error('Document not found on this matter.')
    }
    const matter = await getMatter(ctx, input.matterEntityId)
    if (!matter) throw new Error('Matter not found.')
    const documentEntityId = await withActionContext(ctx, async (client) => {
      const res = await client.query<{ document_entity_id: string }>(
        `SELECT document_entity_id FROM document_version WHERE tenant_id = $1 AND id = $2`,
        [ctx.tenantId, input.documentVersionId],
      )
      return res.rows[0]?.document_entity_id ?? null
    })
    if (!documentEntityId) throw new Error('Document not found on this matter.')
    return requestDocumentReview(ctx, {
      matterEntityId: input.matterEntityId,
      documentEntityId,
      documentVersionId: input.documentVersionId,
      serviceKey: matter.serviceKey,
      originalFilename: object.filename,
      guidance: input.guidance,
    })
  },
}

registerTool(reviewRunTool)
