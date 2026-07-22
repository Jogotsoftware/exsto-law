import { registerTool, type Tool } from '@exsto/mcp-tools'
import { listAttorneyTasks, type AttorneyTask } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// TASK-QUEUE-1 — the unified attorney Task Queue: one aggregated read across
// document review, e-sign, billing (unsent invoices + open payment reports),
// and client requests. See verticals/legal/src/queries/attorneyTasks.ts for the
// per-source normalizers this delegates to. The four underlying tools
// (legal.draft.list_pending, legal.esign.awaiting_me, legal.invoice.list,
// legal.billing.payment_reports, legal.client_request.list_pending) are
// untouched — this is an additive aggregation on top of them.
const tool: Tool<Record<string, never>, { tasks: AttorneyTask[] }> = {
  name: 'legal.attorney.task_queue',
  description:
    'Every task currently waiting on the attorney, aggregated across document review, e-sign, ' +
    'billing (unsent invoices + open payment reports), and client requests — one sortable/' +
    'filterable row per task. Backs the attorney Task Queue.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ tasks: await listAttorneyTasks(ctx) }),
}

registerTool(tool)
