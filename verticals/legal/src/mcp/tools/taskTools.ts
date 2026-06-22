import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listTasksByMatter,
  createTask,
  updateTask,
  archiveTask,
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
  hours: { type: 'string' as const, description: 'Billable hours (e.g. "2.5") when billingMode=hours.' },
  feeAmount: { type: 'string' as const, description: 'Flat fee (e.g. "350") when billingMode=fixed.' },
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
  handler: async (ctx: ActionContext, input) => ({ tasks: await listTasksByMatter(ctx, input.matterEntityId) }),
}

const createTool: Tool<CreateTaskInput, { task: Task }> = {
  name: 'legal.task.create',
  description:
    'Create a task on a matter: a title, optional status / due date / assignee, and optional cost (hours or a fixed fee).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      title: { type: 'string' },
      status: { type: 'string', enum: ['open', 'in_progress', 'blocked', 'done'] },
      dueDate: { type: 'string', description: 'ISO date YYYY-MM-DD.' },
      assigneeActorId: { type: 'string' },
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

registerTool(listTool)
registerTool(createTool)
registerTool(updateTool)
registerTool(archiveTool)
