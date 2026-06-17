import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { getSavedView, type SavedView } from '../queries/savedViews.js'

// Write API for saved views (beta sprint Obj 5). Create/update go through the
// legal.savedview.* actions; delete reuses the core entity.archive. Each returns
// the resolved view so the UI can render immediately.

export interface CreateSavedViewInput {
  name: string
  surface: string
  config: Record<string, unknown>
}

export async function createSavedView(
  ctx: ActionContext,
  input: CreateSavedViewInput,
): Promise<SavedView> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.savedview.create',
    intentKind: 'exploration',
    payload: { name: input.name, surface: input.surface, config: input.config },
  })
  const { savedViewId } = res.effects[0] as { savedViewId: string }
  const created = await getSavedView(ctx, savedViewId)
  if (!created) throw new Error('Saved view created but could not be read back.')
  return created
}

export interface UpdateSavedViewInput {
  savedViewId: string
  name?: string
  config?: Record<string, unknown>
}

export async function updateSavedView(
  ctx: ActionContext,
  input: UpdateSavedViewInput,
): Promise<SavedView> {
  await submitAction(ctx, {
    actionKindName: 'legal.savedview.update',
    intentKind: 'adjustment',
    payload: { saved_view_id: input.savedViewId, name: input.name, config: input.config },
  })
  const updated = await getSavedView(ctx, input.savedViewId)
  if (!updated) throw new Error('Saved view updated but could not be read back.')
  return updated
}

// Delete a saved view through the core entity.archive (status 'archived' — kept
// as history, dropped from active listings). Append-only.
export async function deleteSavedView(
  ctx: ActionContext,
  savedViewId: string,
): Promise<{ savedViewId: string; deleted: true }> {
  await archiveEntity(ctx, savedViewId)
  return { savedViewId, deleted: true }
}
