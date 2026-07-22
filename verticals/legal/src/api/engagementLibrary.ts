// ENGAGEMENT-TEMPLATES-1 (Phase 1) — engagement letters as a first-class template
// LIBRARY. A firm can keep several engagement-letter templates (Outside GC,
// litigation, flat-fee LLC, …); one is the firm DEFAULT that the portal gate
// uses. Each is an ordinary standalone template (docKind 'engagement_letter') —
// fully editable in the attorney template editor — so this module is only the
// thin library layer over them: list, set-default, remove. The default pointer
// is the existing `engagement_template` firm_settings attribute (0189); no new
// migration — docKind is a free string.
import type { ActionContext } from '@exsto/substrate'
import { retireTemplate } from './standaloneTemplates.js'
import { listStandaloneTemplates } from '../queries/templates.js'
import { getEngagementTemplate, setEngagementTemplate } from './engagement.js'

export const ENGAGEMENT_LETTER_DOC_KIND = 'engagement_letter'

export interface EngagementLetterSummary {
  templateId: string
  name: string
  isDefault: boolean
  updatedAt: string
}

// The firm's engagement letters: every template tagged engagement_letter, PLUS
// the current default pointer's template even if it predates the tag (the first
// uploaded letter was created before docKind was applied). Default first, then
// by name.
export async function listEngagementLetters(
  ctx: ActionContext,
): Promise<EngagementLetterSummary[]> {
  const [templates, pointer] = await Promise.all([
    listStandaloneTemplates(ctx),
    getEngagementTemplate(ctx),
  ])
  const defaultId = pointer?.template_id ?? null
  const rows = templates.filter(
    (t) => t.docKind === ENGAGEMENT_LETTER_DOC_KIND || t.templateEntityId === defaultId,
  )
  return rows
    .map((t) => ({
      templateId: t.templateEntityId,
      name: t.name,
      isDefault: t.templateEntityId === defaultId,
      updatedAt: t.updatedAt,
    }))
    .sort((a, b) =>
      a.isDefault === b.isDefault ? a.name.localeCompare(b.name) : a.isDefault ? -1 : 1,
    )
}

// Make one of the firm's engagement letters the default the gate uses. Validates
// the template exists + is active inside setEngagementTemplate's handler.
export async function setDefaultEngagementLetter(
  ctx: ActionContext,
  templateId: string,
): Promise<{ templateId: string | null }> {
  const res = await setEngagementTemplate(ctx, { templateId })
  return { templateId: res.templateId }
}

// Retire an engagement letter. If it was the firm default, clear the pointer so
// the gate never resolves a retired template (falls back to text-terms-only until
// another is set default).
export async function removeEngagementLetter(
  ctx: ActionContext,
  templateId: string,
): Promise<{ removed: string; clearedDefault: boolean }> {
  const pointer = await getEngagementTemplate(ctx)
  const wasDefault = pointer?.template_id === templateId
  if (wasDefault) await setEngagementTemplate(ctx, { templateId: null })
  await retireTemplate(ctx, templateId)
  return { removed: templateId, clearedDefault: wasDefault }
}

// Does the firm already have a default engagement letter? (Used by the import to
// decide whether a freshly-added letter should become the default — the FIRST one
// does; later uploads just join the library, attorney picks the default.)
export async function hasDefaultEngagementLetter(ctx: ActionContext): Promise<boolean> {
  const pointer = await getEngagementTemplate(ctx)
  return Boolean(pointer?.template_id)
}
