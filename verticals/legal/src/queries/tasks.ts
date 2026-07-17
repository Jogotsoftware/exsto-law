import { withActionContext, type ActionContext } from '@exsto/substrate'

// Matter tasks read layer (migration 0084). A `task` is an entity linked to its
// matter by a `task_of` relationship; its fields are latest-wins attributes. A
// done + costed + not-invoiced task is the live source of an unbilled line — that
// rollup lives in queries/billing.ts; this module is plain task reads.

export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done'
export type TaskBillingMode = 'none' | 'hours' | 'fixed'
// A signature task (kind 'signature') carries a document and opens the e-signature
// experience; a plain to-do is 'todo' (the default for tasks created before 0113).
export type TaskKind = 'todo' | 'signature'

export const TASK_STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done']
export const TASK_BILLING_MODES: TaskBillingMode[] = ['none', 'hours', 'fixed']
export const TASK_KINDS: TaskKind[] = ['todo', 'signature']

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
  // Signature-task fields (migration 0113). kind defaults to 'todo'. When kind is
  // 'signature', documentVersionId is the attached doc; esignEnvelopeId is set once
  // sent; reviewedAt is the gate the attorney must clear before status can go done.
  kind: TaskKind
  documentVersionId: string | null
  esignEnvelopeId: string | null
  reviewedAt: string | null
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
  kind: string | null
  document_version_id: string | null
  esign_envelope_id: string | null
  reviewed_at: string | null
  created_at: Date
  updated_at: Date | null
}

const TASK_SELECT = `
  WITH task_of AS (
    SELECT id FROM relationship_kind_definition
    WHERE tenant_id = $1 AND kind_name = 'task_of' AND status = 'active' LIMIT 1
  )
  SELECT
    e.id AS task_id,
    (SELECT r.target_entity_id FROM relationship r
       WHERE r.tenant_id = $1 AND r.source_entity_id = e.id
         AND r.relationship_kind_id = (SELECT id FROM task_of)
         AND (r.valid_to IS NULL OR r.valid_to > now()) LIMIT 1)                  AS matter_id,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_title'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS title,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_status'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS status,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_due_date'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS due_date,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_assignee_actor_id'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS assignee_actor_id,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_billing_mode'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS billing_mode,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_hours'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS hours,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_fee_amount'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS fee_amount,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_invoice_id'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS invoice_id,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_kind'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS kind,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_document_version_id'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS document_version_id,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_esign_envelope_id'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS esign_envelope_id,
    (SELECT a.value #>> '{}' FROM attribute a
      JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
     WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'task_reviewed_at'
     ORDER BY a.valid_from DESC LIMIT 1)                                            AS reviewed_at,
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
function asKind(k: string | null): TaskKind {
  return (TASK_KINDS as string[]).includes(k ?? '') ? (k as TaskKind) : 'todo'
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
    kind: asKind(r.kind),
    documentVersionId: r.document_version_id,
    esignEnvelopeId: r.esign_envelope_id,
    reviewedAt: r.reviewed_at,
    createdAt: r.created_at.toISOString(),
    updatedAt: (r.updated_at ?? r.created_at).toISOString(),
  }
}

// All active tasks on a matter, newest-first. The matter scope is the `task_of`
// relationship, so a task always belongs to exactly one matter.
export async function listTasksByMatter(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<Task[]> {
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

// ── Firm-wide tasks with a due date, for the Calendar's task-due feed ───────
// A due task, enriched with the matter it belongs to (a plain to-do always
// belongs to exactly one matter via `task_of` — see TASK_SELECT above).

export interface DueTask {
  taskId: string
  matterEntityId: string
  matterNumber: string
  title: string
  status: TaskStatus
  dueDate: string
}

type DueTaskRow = TaskRow & { matter_number: string | null }

// All active tasks across every matter whose due date falls in
// [fromDate, toDateExclusive) (plain YYYY-MM-DD strings, compared as text —
// due dates carry no time zone, so this avoids any UTC/local shift). Reuses
// the same TASK_SELECT the per-matter listing uses, just without the matter
// filter, joined to the owning matter's number for display.
export async function listDueTasks(
  ctx: ActionContext,
  opts: { fromDate: string; toDateExclusive: string },
): Promise<DueTask[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<DueTaskRow>(
      `SELECT t.*, m.name AS matter_number
         FROM (${TASK_SELECT}) t
         LEFT JOIN entity m ON m.tenant_id = $1 AND m.id = t.matter_id
        WHERE t.due_date IS NOT NULL AND t.due_date >= $2 AND t.due_date < $3
        ORDER BY t.due_date ASC`,
      [ctx.tenantId, opts.fromDate, opts.toDateExclusive],
    )
    return res.rows
      .filter((r) => r.matter_id) // a task always belongs to a matter; skip any orphan defensively
      .map((r) => ({
        taskId: r.task_id,
        matterEntityId: r.matter_id as string,
        matterNumber: r.matter_number ?? '',
        title: r.title ?? '',
        status: asStatus(r.status),
        dueDate: r.due_date as string,
      }))
  })
}
