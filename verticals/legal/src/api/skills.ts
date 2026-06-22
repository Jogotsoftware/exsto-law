import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { getSkillBySlug, type Skill } from '../queries/skills.js'

// Write API for skills (legal know-how ported from claude-for-legal). Create and
// update go through the legal.skill.* actions; archive reuses the core
// entity.archive. Identified by a stable slug so a re-seed updates in place.

export interface UpsertSkillInput {
  slug: string
  name: string
  practiceArea: string
  description?: string | null
  whenToUse: string
  body: string
  userInvocable?: boolean
}

export async function createSkill(ctx: ActionContext, input: UpsertSkillInput): Promise<Skill> {
  await submitAction(ctx, {
    actionKindName: 'legal.skill.create',
    intentKind: 'enforcement',
    payload: {
      slug: input.slug,
      name: input.name,
      practice_area: input.practiceArea,
      description: input.description ?? null,
      when_to_use: input.whenToUse,
      body: input.body,
      user_invocable: input.userInvocable !== false,
    },
  })
  const created = await getSkillBySlug(ctx, input.slug)
  if (!created) throw new Error('Skill created but could not be read back.')
  return created
}

export interface UpdateSkillInput {
  skillEntityId?: string
  slug?: string
  name?: string
  practiceArea?: string
  description?: string | null
  whenToUse?: string
  body?: string
  userInvocable?: boolean
}

export async function updateSkill(
  ctx: ActionContext,
  input: UpdateSkillInput,
): Promise<Skill | null> {
  await submitAction(ctx, {
    actionKindName: 'legal.skill.update',
    intentKind: 'adjustment',
    payload: {
      skill_entity_id: input.skillEntityId,
      slug: input.slug,
      name: input.name,
      practice_area: input.practiceArea,
      description: input.description,
      when_to_use: input.whenToUse,
      body: input.body,
      user_invocable: input.userInvocable,
    },
  })
  return input.slug ? getSkillBySlug(ctx, input.slug) : null
}

// Create the skill if its slug is new, else update the existing one in place.
// Lets the seed script run idempotently — re-running refreshes bodies without
// duplicating entities.
export async function upsertSkill(ctx: ActionContext, input: UpsertSkillInput): Promise<Skill> {
  const existing = await getSkillBySlug(ctx, input.slug)
  if (!existing) return createSkill(ctx, input)
  const updated = await updateSkill(ctx, {
    slug: input.slug,
    name: input.name,
    practiceArea: input.practiceArea,
    description: input.description,
    whenToUse: input.whenToUse,
    body: input.body,
    userInvocable: input.userInvocable,
  })
  return updated ?? existing
}

// Archive a skill through the core entity.archive action (status 'archived' —
// kept as history, dropped from active listings). Append-only.
export async function archiveSkill(
  ctx: ActionContext,
  skillEntityId: string,
): Promise<{ skillEntityId: string; archived: true }> {
  await archiveEntity(ctx, skillEntityId)
  return { skillEntityId, archived: true }
}
