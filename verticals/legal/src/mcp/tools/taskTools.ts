import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listTasksByMatter,
  getTaskById,
  createTask,
  updateTask,
  archiveTask,
  attachDocumentToTask,
  linkTaskEnvelope,
  reviewTask,
  type Task,
  type CreateTaskInput,
  type UpdateTaskInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Matter tasks (migration 0084) — ad-hoc to-dos on a matter, optionally costed
// (hours or a fixed fee). A done + costed + not-invoiced task surfaces as an
// unbilled line (see billing). Attorney-only (not in CLIENT_PORTAL_TOOLS).

const COST_PROPS = {
  billingMode: {
    type: 'string' as const,
    enum: ['none', 'hours', 'fixed'],
    description: 'How the task bills when done. hours needs `hours`; fixed needs `feeAmount`.',
  },
  hours: {
    type: 'string' as const,
    description: 'Billable hours (e.g. "2.5") when billingMode=hours.',
  },
  feeAmount: {
    type: 'string' as const,
    description: 'Flat fee (e.g. "350") when billingMode=fixed.',
  },
}

const listTool: Tool<{ matterEntityId: string }, { tasks: Task[] }> = {
  name: 'legal.task.list',
  description: "List a matter's tasks (title, status, due date, assignee, and any cost).",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    tasks: await listTasksByMatter(ctx, input.matterEntityId),
  }),
}

const getTool: Tool<{ taskId: string }, { task: Task | null }> = {
  name: 'legal.task.get',
  description:
    'Get a single task by id (title, status, cost, and any attached signature document).',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await getTaskById(ctx, input.taskId) }),
}

const createTool: Tool<CreateTaskInput, { task: Task }> = {
  name: 'legal.task.create',
  description:
    'Create a task on a matter: a title, optional status / due date / assignee, optional cost (hours or a fixed fee), and an optional documentVersionId to make it a signature task.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'] },
      dueDate: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
      assigneeActorId: { type: 'string' },
      documentVersionId: {
        type: 'string',
        description: 'Attach this document_version for signing (makes it a signature task).',
      },
      ...COST_PROPS,
    },
    required: ['matterEntityId', 'title'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await createTask(ctx, input) }),
}

const updateTool: Tool<UpdateTaskInput, { task: Task }> = {
  name: 'legal.task.update',
  description:
    'Update a task (title / status / due date / assignee / billing). Append-only: a new attribute version supersedes the prior.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      taskId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'] },
      dueDate: { type: 'string' },
      assigneeActorId: { type: 'string' },
      ...COST_PROPS,
    },
    required: ['taskId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await updateTask(ctx, input) }),
}

const archiveTool: Tool<{ taskId: string }, { taskId: string; archived: true }> = {
  name: 'legal.task.archive',
  description: 'Archive a task (kept as history, dropped from active listings). Append-only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => archiveTask(ctx, input.taskId),
}

// ── signature tasks (migration 0113) ─────────────────────────────────────────

const attachTool: Tool<{ taskId: string; documentVersionId: string }, { task: Task }> = {
  name: 'legal.task.attach_document',
  description:
    'Attach a document_version to a task for signing — turns it into a signature task that opens the e-signature flow.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' }, documentVersionId: { type: 'string' } },
    required: ['taskId', 'documentVersionId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await attachDocumentToTask(ctx, input) }),
}

const linkEnvelopeTool: Tool<{ taskId: string; envelopeId: string }, { task: Task }> = {
  name: 'legal.task.link_envelope',
  description:
    'Record the signature envelope a task was sent under (call after legal.esign.send_for_signature returns its envelopeId).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' }, envelopeId: { type: 'string' } },
    required: ['taskId', 'envelopeId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await linkTaskEnvelope(ctx, input) }),
}

const reviewTool: Tool<{ taskId: string }, { task: Task }> = {
  name: 'legal.task.review',
  description:
    'Review the executed copy and complete a signature task. Only succeeds once every party has signed (envelope completed).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { taskId: { type: 'string' } },
    required: ['taskId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({ task: await reviewTask(ctx, input) }),
}

registerTool(listTool)
registerTool(getTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
registerTool(attachTool)
registerTool(linkEnvelopeTool)
registerTool(reviewTool)
