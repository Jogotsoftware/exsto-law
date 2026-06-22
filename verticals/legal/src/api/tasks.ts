import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { getTask, type Task } from '../queries/tasks.js'

// Write API for matter tasks (migration 0084). Create/update go through the
// legal.task.* actions; archive reuses the core entity.archive. Each returns the
// resolved task so the UI renders immediately. Mirrors the question-library API.

export interface CreateTaskInput {
  matterEntityId: string
  title: string
  status?: string
  dueDate?: string | null
  assigneeActorId?: string | null
  billingMode?: string
  hours?: string | null
  feeAmount?: string | null
}

export async function createTask(ctx: ActionContext, input: CreateTaskInput): Promise<Task> {
  const title = (input.title ?? '').trim()
  if (!title) throw new Error('A task needs a title.')
  if (!input.matterEntityId) throw new Error('matterEntityId is required.')

  const res = await submitAction(ctx, {
    actionKindName: 'legal.task.create',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: input.matterEntityId,
      title,
      status: input.status ?? 'open',
      due_date: input.dueDate ?? null,
      assignee_actor_id: input.assigneeActorId ?? null,
      billing_mode: input.billingMode ?? 'none',
      hours: input.hours ?? null,
      fee_amount: input.feeAmount ?? null,
    },
  })
  const { taskId } = res.effects[0] as { taskId: string }
  const created = await getTask(ctx, taskId)
  if (!created) throw new Error('Task created but could not be read back.')
  return created
}

export interface UpdateTaskInput {
  taskId: string
  title?: string
  status?: string
  dueDate?: string | null
  assigneeActorId?: string | null
  billingMode?: string
  hours?: string | null
  feeAmount?: string | null
}

export async function updateTask(ctx: ActionContext, input: UpdateTaskInput): Promise<Task> {
  if (!input.taskId) throw new Error('taskId is required.')
  await submitAction(ctx, {
    actionKindName: 'legal.task.update',
    intentKind: 'adjustment',
    payload: {
      task_id: input.taskId,
      title: input.title,
      status: input.status,
      due_date: input.dueDate,
      assignee_actor_id: input.assigneeActorId,
      billing_mode: input.billingMode,
      hours: input.hours,
      fee_amount: input.feeAmount,
    },
  })
  const updated = await getTask(ctx, input.taskId)
  if (!updated) throw new Error('Task updated but could not be read back.')
  return updated
}

// Archive through the core entity.archive action (kept as history, dropped from
// active listings). Append-only.
export async function archiveTask(
  ctx: ActionContext,
  taskId: string,
): Promise<{ taskId: string; archived: true }> {
  await archiveEntity(ctx, taskId)
  return { taskId, archived: true }
}
