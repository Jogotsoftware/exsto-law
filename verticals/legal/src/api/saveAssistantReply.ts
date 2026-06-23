import type { ActionContext } from '@exsto/substrate'
import { cacheDraft } from './cacheDraft.js'

export interface SaveAssistantReplyInput {
  matterEntityId: string
  markdown: string
  // Stored verbatim as the draft's document_kind. Defaults to assistant_draft.
  documentKind?: string
  modelIdentity?: string
}

// Save an assistant chat reply as a document_draft on a matter (status
// pending_review), so a useful answer/letter/memo can be kept on the matter
// instead of copy-pasted out (beta ask). Reuses the existing draft.generate path
// (via cacheDraft) — the reply lands as a draft the attorney reviews/approves like
// any AI draft, with NO new action kind or migration needed.
export async function saveAssistantReplyToMatter(
  ctx: ActionContext,
  input: SaveAssistantReplyInput,
): Promise<{ draftVersionId: string | null }> {
  if (!input.matterEntityId) throw new Error('matterEntityId is required.')
  const markdown = input.markdown?.trim()
  if (!markdown) throw new Error('Nothing to save — the reply is empty.')

  const res = await cacheDraft(ctx, {
    matterEntityId: input.matterEntityId,
    documentKind: input.documentKind?.trim() || 'assistant_draft',
    documentMarkdown: markdown,
    prompt: 'Saved from the assistant chat for attorney review.',
    reasoningTrace: {
      evidence: [],
      alternatives_considered: [],
      conclusion:
        'Saved verbatim from an assistant chat reply; the attorney reviews and approves it like any AI draft.',
      confidence: 1,
      ambiguities: [],
    },
    modelIdentity: input.modelIdentity?.trim() || 'assistant-chat',
  })

  const effect = res.effects?.[0] as { documentVersionId?: string } | undefined
  return { draftVersionId: effect?.documentVersionId ?? null }
}
