// CHATBOT-CATCHUP-1 — the get_task_queue ClientTool. READ-ONLY, registered on
// EVERY attorney turn (like its get_attention_feed sibling) so "what's waiting
// on me?" / "what's in my queue?" is answered from the REAL unified Task Queue
// (queries/attorneyTasks.ts — document review, e-sign, billing, client
// requests, workflow steps, to-dos), not a model guess. This tool is the thin
// chat adapter over listAttorneyTasks; it NEVER writes. The paired ACT surfaces
// (the review page, the e-sign composer, /attorney/review) stay where they are —
// the tool hands the model each task's workHref so it can point the attorney at
// the right surface to act.
import type { ActionContext } from '@exsto/substrate'
import type { ClientTool } from '../adapters/claude.js'
import { listAttorneyTasks, type AttorneyTask } from '../queries/attorneyTasks.js'

// One call hands back at most this many tasks — enough to triage without
// flooding the reply (mirrors attentionFeedTool's TOOL_FEED_LIMIT).
const TOOL_QUEUE_LIMIT = 25

const GET_TASK_QUEUE_TOOL_DEF = {
  name: 'get_task_queue',
  description:
    "Read the attorney's unified TASK QUEUE — every task currently waiting on THEM, aggregated across document review, e-sign, billing (unsent invoices + payment reports), client requests, workflow steps, and to-dos. This is the same queue as the /attorney/review page. READ-ONLY: it never changes anything. Call it whenever the attorney asks what is waiting on them, what needs their review/approval/signature, or what their queue looks like. (For INBOUND client messages awaiting a reply, get_attention_feed is the sibling feed.) Each task carries a type, a client/matter, and an in-app link (workHref): answer by summarizing what's waiting and offering the links to act. Do NOT invent tasks or deadlines — report only what the queue returns, and if it is empty, say plainly that nothing is waiting.",
  input_schema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
}

// The read-back the model receives: one line per task with the type, title,
// client/matter, date label and the workHref to act. Empty queue is an explicit,
// honest "nothing waiting" — never blurred.
export function renderTaskQueueForModel(tasks: AttorneyTask[]): string {
  if (tasks.length === 0) {
    return 'The task queue is empty — nothing is waiting on the attorney right now. Tell them that plainly; do not invent tasks.'
  }
  const shown = tasks.slice(0, TOOL_QUEUE_LIMIT)
  const lines = shown.map((t) => {
    const who = [t.clientName, t.matterNumber].filter(Boolean).join(', ')
    const when = t.date ? ` (${t.dateLabel} ${t.date.slice(0, 10)})` : ''
    return `- [${t.typeLabel}] ${t.title}${who ? ` — ${who}` : ''}${when} (act: ${t.workHref})`
  })
  const more =
    tasks.length > shown.length
      ? `\n…and ${tasks.length - shown.length} more — the full queue is at /attorney/review.`
      : ''
  return (
    `${tasks.length} task${tasks.length === 1 ? '' : 's'} waiting on the attorney. Summarize in your own words and offer the links to act — do not paste this list verbatim:\n` +
    lines.join('\n') +
    more
  )
}

// Injectable seam (mirrors AttentionFeedToolDeps) so the unit test pins the
// read-back with a plain fake — no DB.
export interface TaskQueueToolDeps {
  listAttorneyTasks: (ctx: ActionContext) => Promise<AttorneyTask[]>
}

const DEFAULT_DEPS: TaskQueueToolDeps = {
  listAttorneyTasks: (ctx) => listAttorneyTasks(ctx),
}

export function buildTaskQueueTool(
  ctx: ActionContext,
  deps: TaskQueueToolDeps = DEFAULT_DEPS,
): ClientTool {
  return {
    definition: GET_TASK_QUEUE_TOOL_DEF,
    name: 'get_task_queue',
    run: async () => {
      const tasks = await deps.listAttorneyTasks(ctx)
      return renderTaskQueueForModel(tasks)
    },
  }
}
