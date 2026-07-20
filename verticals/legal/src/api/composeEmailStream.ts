// COMPOSE-STREAM — "Draft with AI" for the attorney compose modal. Streams a
// concrete client email (SUBJECT: first line, then body) built from the SAME
// context assembly the worker-side email_generation capability uses — the
// email-drafting prompt template, getClientContext client memory, matter facts,
// the matter's resolved jurisdiction, and jurisdiction skills — but as PURE
// GENERATION into the attorney's draft box: no substrate write, no reasoning
// trace (the recorded action stays the send, mail.send). That is the deliberate
// contrast with composeEmailDraft (generateEmail.ts), which persists a
// review-queue draft and is WORKER-ONLY.
//
// TENANT SAFETY: this runs in-request on the ATTORNEY's own ActionContext from
// the signed session (resolveAttorneyCtx) — reads are tenant-scoped by RLS and
// attributed to the attorney. Never the tenant-zero CLAUDE_AGENT_ACTOR_ID
// constant (a known 2nd-firm hazard in the worker paths).
import type { ActionContext } from '@exsto/substrate'
import { streamChatWithAssistant } from '../adapters/claude.js'
import { loadEmailDraftingPrompt } from '../templates/loader.js'
import { getMatter } from '../queries/matters.js'
import { getClientContext, formatClientContext } from '../queries/clientContext.js'
import { resolveMatterJurisdiction } from './matterJurisdiction.js'
import {
  loadForcedSkills,
  buildActiveSkillsText,
  resolveJurisdictionSkillSlugs,
} from './skillContext.js'
import { resolveModelForTask } from '../lib/modelRouter.js'
import { CLIENT_EMAIL_DOCUMENT_KIND } from './generateEmail.js'

export interface ComposeEmailStreamInput {
  // What the attorney wants the email to accomplish (the short prompt).
  instructions: string
  // Scope for context gathering. matterEntityId wins (facts + jurisdiction +
  // client memory); clientEntityId alone still rides client memory. Both
  // optional — a bare instruction drafts with honest empty-context markers.
  matterEntityId?: string
  clientEntityId?: string
}

export async function* streamComposeEmail(
  ctx: ActionContext,
  input: ComposeEmailStreamInput,
): AsyncGenerator<{ type: 'text'; text: string } | { type: 'thinking'; text: string }> {
  const instructions = input.instructions?.trim()
  if (!instructions) throw new Error('Say what this email should accomplish.')

  // Matter scope (optional): facts + jurisdiction, and the client parent for memory.
  let clientEntityId = input.clientEntityId?.trim() || null
  let matterFacts: Record<string, unknown> = {}
  let jurisdictionCode: string | undefined
  if (input.matterEntityId?.trim()) {
    const matter = await getMatter(ctx, input.matterEntityId.trim())
    if (!matter) throw new Error(`Matter not found: ${input.matterEntityId}`)
    clientEntityId = clientEntityId ?? matter.clientEntityId ?? null
    const jurisdiction = await resolveMatterJurisdiction(ctx, input.matterEntityId.trim())
    jurisdictionCode = jurisdiction?.code ?? undefined
    matterFacts = {
      matter_number: matter.matterNumber,
      service_key: matter.serviceKey,
      matter_status: matter.status,
      client_name: matter.clientName || null,
      intake_answers: matter.questionnaireResponses ?? {},
    }
  }

  // Client memory rides the prompt whenever a client is resolvable (WP1.4
  // discipline from the worker path); otherwise an honest empty marker.
  let clientContextText = '(no client history on file for this recipient)'
  if (clientEntityId) {
    const context = await getClientContext(ctx, clientEntityId)
    if (context) clientContextText = formatClientContext(context)
  }

  // Same prompt template + inert function-replacer discipline as generateEmail.
  let prompt = loadEmailDraftingPrompt()
    .replaceAll('{{purpose}}', () => instructions)
    .replaceAll('{{recipient_role}}', () => 'client')
    .replaceAll('{{matter_facts_json}}', () => JSON.stringify(matterFacts, null, 2))
    .replaceAll('{{client_context}}', () => clientContextText)

  const autoSkillSlugs = await resolveJurisdictionSkillSlugs(ctx, {
    documentKind: CLIENT_EMAIL_DOCUMENT_KIND,
    jurisdiction: jurisdictionCode,
  })
  const skillsText = buildActiveSkillsText(await loadForcedSkills(ctx, autoSkillSlugs))
  if (skillsText.trim()) prompt += `\n\n${skillsText.trim()}`

  const model = resolveModelForTask('email_generate').model
  for await (const chunk of streamChatWithAssistant(
    ctx.tenantId,
    [{ role: 'user', content: prompt }],
    { model },
  )) {
    if (chunk.type === 'text') yield { type: 'text', text: chunk.text }
    else if (chunk.type === 'thinking') yield { type: 'thinking', text: chunk.text }
  }
}
