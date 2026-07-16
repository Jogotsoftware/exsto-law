// UI-BUILDER-FIX-1 Phase 10 — template ⇄ questionnaire sync. When a template is
// SAVED with fill-in tokens its feeding questionnaire doesn't capture:
//   1. confirm (or create, by best token overlap) the questionnaire_feeds_template
//      relationship — the kind shipped in migration 0109 with a full write path
//      (legal.questionnaire_template.set_templates) and ZERO live edges until now;
//   2. enqueue (worker_job — legal.config.regenerate) an AI REBUILD PROPOSAL for
//      the questionnaire, surfaced through the Phase-9 edit modal for attorney
//      approval. NEVER auto-applied.
// Best-effort by design: a sync failure must never fail the template save.
import type { ActionContext } from '@exsto/substrate'
import {
  listQuestionnaireTemplates,
  type QuestionnaireTemplate,
} from '../queries/questionnaireLibrary.js'
import { setQuestionnaireTemplates } from './questionnaireLibrary.js'
import { enqueueConfigRegenerate } from './configRegenerate.js'
// P13 — the shared token classification (was a local set here; now the one
// module every consumer reads, pinned to MERGE_SLOT_FIELDS by test).
import { isSystemToken } from './tokenClasses.js'

const TOKEN_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

// System tokens are filled by the platform/matter, never by a questionnaire —
// their absence from a questionnaire is not a gap.
export function templateTokens(body: string): string[] {
  const seen = new Set<string>()
  for (const m of body.matchAll(TOKEN_RE)) {
    const t = m[1]?.toLowerCase()
    if (t && !isSystemToken(t)) seen.add(t)
  }
  return [...seen]
}

function fieldIds(q: QuestionnaireTemplate): Set<string> {
  const ids = new Set<string>()
  for (const s of q.schema?.sections ?? []) {
    for (const f of s.fields ?? []) {
      if (f.id) ids.add(String(f.id).toLowerCase())
    }
  }
  return ids
}

export interface TemplateSyncOutcome {
  questionnaireTemplateId: string | null
  linkCreated: boolean
  missingTokens: string[]
  rebuildEnqueued: boolean
}

export async function syncQuestionnaireForTemplate(
  ctx: ActionContext,
  templateEntityId: string,
  body: string,
): Promise<TemplateSyncOutcome> {
  const tokens = templateTokens(body)
  const none: TemplateSyncOutcome = {
    questionnaireTemplateId: null,
    linkCreated: false,
    missingTokens: [],
    rebuildEnqueued: false,
  }
  if (tokens.length === 0) return none

  const questionnaires = await listQuestionnaireTemplates(ctx)
  if (questionnaires.length === 0) return none

  // Prefer the questionnaire ALREADY linked to this template; otherwise the one
  // with the highest field↔token overlap (≥1) — that's the questionnaire that
  // feeds this template's fill-ins.
  let linked =
    questionnaires.find((q) =>
      (q.associatedTemplates ?? []).some((t) => t.templateEntityId === templateEntityId),
    ) ?? null
  let linkCreated = false
  if (!linked) {
    let best: { q: QuestionnaireTemplate; overlap: number } | null = null
    for (const q of questionnaires) {
      const ids = fieldIds(q)
      const overlap = tokens.filter((t) => ids.has(t)).length
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { q, overlap }
    }
    if (!best) return none // no questionnaire plausibly feeds this template
    linked = best.q
    // Create the edge: the set_templates write path takes the FULL desired set,
    // so carry the questionnaire's existing links plus this template.
    const existing = (linked.associatedTemplates ?? []).map((t) => t.templateEntityId)
    await setQuestionnaireTemplates(ctx, {
      questionnaireTemplateId: linked.questionnaireTemplateId,
      templateEntityIds: [...existing, templateEntityId],
    })
    linkCreated = true
  }

  const ids = fieldIds(linked)
  const missingTokens = tokens.filter((t) => !ids.has(t))
  let rebuildEnqueued = false
  if (missingTokens.length > 0) {
    // The rebuild PROPOSAL runs off-request (worker_job) and lands as a
    // config.regenerate.completed event; the Phase-9 questionnaire modal
    // surfaces it for approval. Never auto-applied.
    await enqueueConfigRegenerate(ctx, {
      artifactKind: 'questionnaire',
      targetId: linked.questionnaireTemplateId,
      prompt:
        `The document template this questionnaire feeds was just edited and now has fill-in ` +
        `fields the questionnaire does not capture: ${missingTokens
          .map((t) => `{{${t}}}`)
          .join(', ')}. Add one appropriately-typed, clearly-labeled question per missing ` +
        `field (field id = the token name), in the most fitting existing section. Change nothing else.`,
      current: JSON.stringify(linked.schema ?? { sections: [] }, null, 2),
    })
    rebuildEnqueued = true
  }

  return {
    questionnaireTemplateId: linked.questionnaireTemplateId,
    linkCreated,
    missingTokens,
    rebuildEnqueued,
  }
}
