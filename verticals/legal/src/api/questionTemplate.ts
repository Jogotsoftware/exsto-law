import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import {
  getQuestionTemplate,
  listQuestionTemplates,
  listQuestionTokens,
  type QuestionTemplate,
} from '../queries/questionTemplate.js'

// Write API for the question library (migration 0077). Create/update go through
// the legal.question_template.* actions; archive reuses the core entity.archive.
// Each returns the resolved question so the UI renders immediately. Mirrors the
// questionnaire-library write API.

// A {{answer}} token is a snake_case slug. The token is what binds a template
// merge-field to this question, so it must be a valid token name and unique in
// the library (else a merge-field would bind ambiguously).
function slugifyToken(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^([0-9])/, '_$1') // tokens can't start with a digit
      .slice(0, 60) || 'answer'
  )
}

// Make `base` unique against `taken` by appending _2, _3, … (skips `self` so an
// update keeps its own token).
function uniqueToken(base: string, taken: Set<string>, self?: string): string {
  if (base === self || !taken.has(base)) return base
  let i = 2
  while (taken.has(`${base}_${i}`)) i++
  return `${base}_${i}`
}

export interface CreateQuestionTemplateInput {
  label: string
  type: string
  // Optional explicit token; otherwise derived from the label. Always normalized
  // to a valid, unique snake_case slug.
  token?: string
  options?: string[] | null
}

// "Create" is an UPSERT keyed on the {{answer}} token. A token must map to exactly
// one question (that is the whole "bind once, fill everywhere" premise), so saving
// a question whose token already exists UPDATES that library entry rather than
// minting a near-duplicate (full_name / full_name_2 / …). Genuinely new questions
// get a fresh token derived from the label.
export async function createQuestionTemplate(
  ctx: ActionContext,
  input: CreateQuestionTemplateInput,
): Promise<QuestionTemplate> {
  const label = (input.label ?? '').trim()
  if (!label) throw new Error('A question needs a label.')
  const token = slugifyToken(input.token?.trim() || label)

  const existing = (await listQuestionTemplates(ctx)).find((q) => q.token === token)
  if (existing) {
    // Same token → update in place (idempotent save), so the bank never fills with
    // duplicates and the existing binding stays stable.
    return updateQuestionTemplate(ctx, {
      questionTemplateId: existing.questionTemplateId,
      label,
      type: input.type,
      options: input.options ?? null,
    })
  }

  const res = await submitAction(ctx, {
    actionKindName: 'legal.question_template.create',
    intentKind: 'enforcement',
    payload: {
      label,
      type: input.type,
      token,
      options: input.options ?? null,
    },
  })
  const { questionTemplateId } = res.effects[0] as { questionTemplateId: string }
  const created = await getQuestionTemplate(ctx, questionTemplateId)
  if (!created) throw new Error('Question created but could not be read back.')
  return created
}

export interface UpdateQuestionTemplateInput {
  questionTemplateId: string
  label?: string
  type?: string
  // Renaming the token is allowed but re-normalized + kept unique; templates that
  // referenced the old token will need re-binding (surfaced by template validation).
  token?: string
  options?: string[] | null
}

export async function updateQuestionTemplate(
  ctx: ActionContext,
  input: UpdateQuestionTemplateInput,
): Promise<QuestionTemplate> {
  if (!input.questionTemplateId) throw new Error('questionTemplateId is required.')

  let token: string | undefined
  if (input.token != null) {
    const current = await getQuestionTemplate(ctx, input.questionTemplateId)
    const taken = await listQuestionTokens(ctx)
    token = uniqueToken(slugifyToken(input.token.trim()), taken, current?.token)
  }

  await submitAction(ctx, {
    actionKindName: 'legal.question_template.update',
    intentKind: 'adjustment',
    payload: {
      question_template_id: input.questionTemplateId,
      label: input.label,
      type: input.type,
      token,
      options: input.options,
    },
  })
  const updated = await getQuestionTemplate(ctx, input.questionTemplateId)
  if (!updated) throw new Error('Question updated but could not be read back.')
  return updated
}

// Archive through the core entity.archive action (status 'archived' — kept as
// history, dropped from active listings). Append-only.
export async function archiveQuestionTemplate(
  ctx: ActionContext,
  questionTemplateId: string,
): Promise<{ questionTemplateId: string; archived: true }> {
  await archiveEntity(ctx, questionTemplateId)
  return { questionTemplateId, archived: true }
}
