import { withActionContext, type ActionContext } from '@exsto/substrate'

// Matter tasks read layer (migration 0084). A `task` is an entity linked to its
// matter by a `task_of` relationship; its fields are latest-wins attributes. A
// done + costed + not-invoiced task is the live source of an unbilled line — that
// rollup lives in queries/billing.ts; this module is plain task reads.

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done'
export type TaskBillingMode = 'none' | 'hours' | 'fixed'

export const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done']
export const TASK_BILLING_MODES: TaskBillingMode[] = ['none', 'hours', 'fixed']

export interface Task {
  taskId: string
  matterId: string | null
  title: string
  status: TaskStatus
  dueDate: string | null
  assigneeActorId: string | null
  billingMode: TaskBillingMode
  // Decimal strings (hours billed by time; feeAmount for a fixed fee). Null unless
  // the matching billing mode is set.
  hours: string | null
  feeAmount: string | null
  // Set to the invoice entity id once the task's cost is placed on an invoice —
  // this LOCKS it (it stops showing as unbilled and can't be un-billed).
  invoiceId: string | null
  createdAt: string
  updatedAt: string
}

type TaskRow = {
  task_id: string
  matter_id: string | null
  title: string | null
  status: string | null
  due_date: string | null
  assignee_actor_id: string | null
  billing_mode: string | null
  hours: string | null
  fee_amount: string | null
  invoice_id: string | null
  created_at: Date
  updated_at: Date | null
}

const TASK_SELECT = `
  WITH attrs AS (
    SELECT DISTINCT ON (a.entity_id, akd.kind_name) a.entity_id, akd.kind_name, a.value, a.valid_from
    FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
    WHERE a.tenant_id = $1 ORDER BY a.entity_id, akd.kind_name, a.valid_from DESC
  ),
  task_of AS (
    SELECT id FROM relationship_kind_definition
    WHERE tenant_id = $1 AND kind_name = 'task_of' AND status = 'active' LIMIT 1
  )
  SELECT
    e.id AS task_id,
    (SELECT r.target_entity_id FROM relationship r
       WHERE r.tenant_id = $1 AND r.source_entity_id = e.id
         AND r.relationship_kind_id = (SELECT id FROM task_of)
         AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1)                  AS matter_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_title')             AS title,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_status')            AS status,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_due_date')          AS due_date,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_assignee_actor_id') AS assignee_actor_id,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_billing_mode')      AS billing_mode,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_hours')             AS hours,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_fee_amount')        AS fee_amount,
    (SELECT value #>> '{}' FROM attrs WHERE entity_id = e.id AND kind_name = 'task_invoice_id')        AS invoice_id,
    e.created_at,
    (SELECT max(a.valid_from) FROM attribute a WHERE a.tenant_id = $1 AND a.entity_id = e.id)          AS updated_at
  FROM entity e
  JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id AND ekd.kind_name = 'task'
  WHERE e.tenant_id = $1 AND e.status = 'active'`

function asStatus(s: string | null): TaskStatus {
  return (TASK_STATUSES as string[]).includes(s ?? '') ? (s as TaskStatus) : 'open'
}
function asMode(m: string | null): TaskBillingMode {
  return (TASK_BILLING_MODES as string[]).includes(m ?? '') ? (m as TaskBillingMode) : 'none'
}

function mapTask(r: TaskRow): Task {
  return {
    taskId: r.task_id,
    matterId: r.matter_id,
    title: r.title ?? '',
    status: asStatus(r.status),
    dueDate: r.due_date,
    assigneeActorId: r.assignee_actor_id,
    billingMode: asMode(r.billing_mode),
    hours: r.hours,
    feeAmount: r.fee_amount,
    invoiceId: r.invoice_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: (r.updated_at ?? r.created_at).toISOString(),
  }
}

// All active tasks on a matter, newest-first. The matter scope is the `task_of`
// relationship, so a task always belongs to exactly one matter.
export async function listTasksByMatter(ctx: ActionContext, matterEntityId: string): Promise<Task[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TaskRow>(
      `${TASK_SELECT}
         AND EXISTS (
           SELECT 1 FROM relationship r
            WHERE r.tenant_id = $1 AND r.source_entity_id = e.id
              AND r.relationship_kind_id = (SELECT id FROM task_of)
              AND r.target_entity_id = $2
              AND (r.valid_to IS NULL OR r.valid_to > now()))
       ORDER BY e.created_at DESC`,
      [ctx.tenantId, matterEntityId],
    )
    return res.rows.map(mapTask)
  })
}

export async function getTask(ctx: ActionContext, taskId: string): Promise<Task | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<TaskRow>(`${TASK_SELECT} AND e.id = $2`, [ctx.tenantId, taskId])
    return res.rows[0] ? mapTask(res.rows[0]) : null
  })
}
