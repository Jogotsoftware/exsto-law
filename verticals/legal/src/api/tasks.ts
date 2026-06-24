import { submitAction, type ActionContext } from '@exsto/substrate'
import { archiveEntity } from '@exsto/primitives'
import { getTask, type Task } from '../queries/tasks.js'
import { getEnvelopeStatus } from './esign.js'

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
  // When set, the task is a signature task carrying this document_version.
  documentVersionId?: string | null
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
      document_version_id: input.documentVersionId ?? null,
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

// ── signature tasks (migration 0113) ─────────────────────────────────────────

// Attach a document to an existing task, turning it into a signature task.
export async function attachDocumentToTask(
  ctx: ActionContext,
  input: { taskId: string; documentVersionId: string },
): Promise<Task> {
  if (!input.taskId) throw new Error('taskId is required.')
  if (!input.documentVersionId) throw new Error('documentVersionId is required.')
  await submitAction(ctx, {
    actionKindName: 'legal.task.attach_document',
    intentKind: 'enforcement',
    payload: { task_id: input.taskId, document_version_id: input.documentVersionId },
  })
  const t = await getTask(ctx, input.taskId)
  if (!t) throw new Error('Task not found after attaching document.')
  return t
}

// Record the signature envelope a task was sent under (called after the
// send_for_signature returns its envelopeId).
export async function linkTaskEnvelope(
  ctx: ActionContext,
  input: { taskId: string; envelopeId: string },
): Promise<Task> {
  if (!input.taskId) throw new Error('taskId is required.')
  if (!input.envelopeId) throw new Error('envelopeId is required.')
  await submitAction(ctx, {
    actionKindName: 'legal.task.link_envelope',
    intentKind: 'automatic_sync',
    payload: { task_id: input.taskId, envelope_id: input.envelopeId },
  })
  const t = await getTask(ctx, input.taskId)
  if (!t) throw new Error('Task not found after linking envelope.')
  return t
}

// The review gate: an attorney can only complete a signature task after every
// party has signed (envelope `completed`). Verified here before the action runs.
export async function reviewTask(ctx: ActionContext, input: { taskId: string }): Promise<Task> {
  if (!input.taskId) throw new Error('taskId is required.')
  const task = await getTask(ctx, input.taskId)
  if (!task) throw new Error('Task not found.')
  if (task.kind !== 'signature' || !task.esignEnvelopeId) {
    throw new Error('This task has no signature envelope to review.')
  }
  const env = await getEnvelopeStatus(ctx, task.esignEnvelopeId)
  if (env.status !== 'completed') {
    throw new Error(
      'All parties must finish signing before the task can be reviewed and completed.',
    )
  }
  await submitAction(ctx, {
    actionKindName: 'legal.task.review',
    intentKind: 'enforcement',
    payload: { task_id: input.taskId, reviewed_at: new Date().toISOString() },
  })
  const t = await getTask(ctx, input.taskId)
  if (!t) throw new Error('Task not found after review.')
  return t
}

// Read a single task by id (exposes the queries-layer getTask for the MCP tool).
export async function getTaskById(ctx: ActionContext, taskId: string): Promise<Task | null> {
  return getTask(ctx, taskId)
}
