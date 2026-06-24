import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, insertRelationship, lookupKindId } from './common.js'
import { TASK_STATUSES, TASK_BILLING_MODES } from '../queries/tasks.js'

// ───────────────────────────────────────────────────────────────────────────
// Matter task handlers (migration 0084). A `task` entity is an ad-hoc to-do on a
// matter (task_of relationship), optionally costed (hours or a fixed fee). .create
// makes one; .update supersedes its attributes (append-only). Archival reuses the
// core entity.archive action. task_invoice_id is NOT user-settable — only the
// invoice handler sets it (locking the task once billed).
// ───────────────────────────────────────────────────────────────────────────

const TASK_ENTITY_KIND = 'task'
const STATUSES = new Set<string>(TASK_STATUSES)
const MODES = new Set<string>(TASK_BILLING_MODES)

async function setAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

// A positive decimal string (hours: any precision; money: handled by the invoice
// roll-up later). Empty/blank is rejected by the caller before this runs.
function assertDecimal(label: string, v: unknown): string {
  const s = String(v ?? '').trim()
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error(`${label} must be a number like 2 or 2.5.`)
  return s
}

// Validate the cost trio. Returns the attribute writes the mode implies (and the
// clears for the unused field, so switching modes never leaves a stale cost).
function costAttrs(
  mode: string,
  hours: unknown,
  fee: unknown,
): Array<{ kind: string; value: unknown }> {
  if (mode === 'hours') {
    return [
      { kind: 'task_hours', value: assertDecimal('Hours', hours) },
      { kind: 'task_fee_amount', value: null },
    ]
  }
  if (mode === 'fixed') {
    return [
      { kind: 'task_fee_amount', value: assertDecimal('Fixed fee', fee) },
      { kind: 'task_hours', value: null },
    ]
  }
  // none → no cost
  return [
    { kind: 'task_hours', value: null },
    { kind: 'task_fee_amount', value: null },
  ]
}

// Attach a document to a task (migration 0113): mark it a signature task, link it
// to the document entity (derived from the version id), and pin the exact version.
async function attachDocument(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    taskId: string
    documentVersionId: string
  },
): Promise<void> {
  const dv = await client.query<{ document_entity_id: string }>(
    `SELECT document_entity_id FROM document_version WHERE id = $1 AND tenant_id = $2`,
    [args.documentVersionId, args.tenantId],
  )
  const documentEntityId = dv.rows[0]?.document_entity_id
  if (!documentEntityId) throw new Error('Attached document version not found.')

  const relKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    args.tenantId,
    'task_document',
  )
  await insertRelationship(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    sourceEntityId: args.taskId,
    targetEntityId: documentEntityId,
    relationshipKindId: relKindId,
  })
  const base = {
    tenantId: args.tenantId,
    actionId: args.actionId,
    actorId: args.actorId,
    entityId: args.taskId,
  }
  await setAttr(client, { ...base, kind: 'task_kind', value: 'signature' })
  await setAttr(client, {
    ...base,
    kind: 'task_document_version_id',
    value: args.documentVersionId,
  })
}

interface CreatePayload {
  matter_entity_id: string
  title: string
  status?: string
  due_date?: string | null
  assignee_actor_id?: string | null
  billing_mode?: string
  hours?: string | null
  fee_amount?: string | null
  // Optional: when present, the task is a signature task carrying this document.
  document_version_id?: string | null
}

registerActionHandler('legal.task.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as CreatePayload
  const title = (p.title ?? '').trim()
  if (!title) throw new Error('A task needs a title.')
  if (!p.matter_entity_id) throw new Error('matter_entity_id is required.')
  const status = p.status ?? 'open'
  if (!STATUSES.has(status)) throw new Error(`Unknown status "${status}".`)
  const mode = p.billing_mode ?? 'none'
  if (!MODES.has(mode)) throw new Error(`Unknown billing mode "${mode}".`)

  const taskKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    TASK_ENTITY_KIND,
  )
  const taskId = await insertEntity(client, ctx.tenantId, actionId, taskKindId, title, {})

  // Link the task to its matter.
  const relKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'task_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: taskId,
    targetEntityId: p.matter_entity_id,
    relationshipKindId: relKindId,
  })

  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'task_title', value: title },
    { kind: 'task_status', value: status },
    { kind: 'task_billing_mode', value: mode },
    ...costAttrs(mode, p.hours, p.fee_amount),
  ]
  if (p.due_date != null && String(p.due_date).trim()) {
    attrs.push({ kind: 'task_due_date', value: String(p.due_date).trim() })
  }
  if (p.assignee_actor_id != null && String(p.assignee_actor_id).trim()) {
    attrs.push({ kind: 'task_assignee_actor_id', value: String(p.assignee_actor_id).trim() })
  }
  for (const a of attrs) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: taskId,
      kind: a.kind,
      value: a.value,
    })
  }

  // A task created with a document is a signature task from the start.
  if (p.document_version_id != null && String(p.document_version_id).trim()) {
    await attachDocument(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      taskId,
      documentVersionId: String(p.document_version_id).trim(),
    })
  }

  return { taskId }
})

interface UpdatePayload {
  task_id: string
  title?: string
  status?: string
  due_date?: string | null
  assignee_actor_id?: string | null
  billing_mode?: string
  hours?: string | null
  fee_amount?: string | null
}

registerActionHandler('legal.task.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as UpdatePayload
  if (!p.task_id) throw new Error('task_id is required.')

  const updates: Array<{ kind: string; value: unknown }> = []
  if (p.title != null) {
    const title = p.title.trim()
    if (!title) throw new Error('Title cannot be blank.')
    updates.push({ kind: 'task_title', value: title })
  }
  if (p.status != null) {
    if (!STATUSES.has(p.status)) throw new Error(`Unknown status "${p.status}".`)
    updates.push({ kind: 'task_status', value: p.status })
  }
  if (p.due_date !== undefined) {
    const d = p.due_date == null ? null : String(p.due_date).trim() || null
    updates.push({ kind: 'task_due_date', value: d })
  }
  if (p.assignee_actor_id !== undefined) {
    const a = p.assignee_actor_id == null ? null : String(p.assignee_actor_id).trim() || null
    updates.push({ kind: 'task_assignee_actor_id', value: a })
  }
  // Changing the billing mode re-derives the cost fields together (and clears the
  // unused one), so a task never carries a stale hours/fee from a prior mode.
  if (p.billing_mode != null) {
    if (!MODES.has(p.billing_mode)) throw new Error(`Unknown billing mode "${p.billing_mode}".`)
    updates.push({ kind: 'task_billing_mode', value: p.billing_mode })
    updates.push(...costAttrs(p.billing_mode, p.hours, p.fee_amount))
  }

  for (const u of updates) {
    await setAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: p.task_id,
      kind: u.kind,
      value: u.value,
    })
  }

  return { taskId: p.task_id, updated: updates.map((u) => u.kind) }
})

// ── signature-task actions (migration 0113) ──────────────────────────────────

interface AttachPayload {
  task_id: string
  document_version_id: string
}

registerActionHandler('legal.task.attach_document', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AttachPayload
  if (!p.task_id) throw new Error('task_id is required.')
  if (!p.document_version_id) throw new Error('document_version_id is required.')
  await attachDocument(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    taskId: p.task_id,
    documentVersionId: p.document_version_id,
  })
  return { taskId: p.task_id }
})

interface LinkEnvelopePayload {
  task_id: string
  envelope_id: string
}

registerActionHandler('legal.task.link_envelope', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as LinkEnvelopePayload
  if (!p.task_id) throw new Error('task_id is required.')
  if (!p.envelope_id) throw new Error('envelope_id is required.')
  await setAttr(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId: p.task_id,
    kind: 'task_esign_envelope_id',
    value: p.envelope_id,
  })
  return { taskId: p.task_id }
})

interface ReviewPayload {
  task_id: string
  reviewed_at: string
}

// The review gate: records the attorney's review of the executed copy AND moves the
// task to `done`. The caller (api/tasks.reviewTask) verifies the envelope is
// `completed` before submitting, so a task never completes while signatures are open.
registerActionHandler('legal.task.review', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as ReviewPayload
  if (!p.task_id) throw new Error('task_id is required.')
  const reviewedAt = (p.reviewed_at ?? '').trim()
  if (!reviewedAt) throw new Error('reviewed_at is required.')
  const base = {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    entityId: p.task_id,
  }
  await setAttr(client, { ...base, kind: 'task_reviewed_at', value: reviewedAt })
  await setAttr(client, { ...base, kind: 'task_status', value: 'done' })
  return { taskId: p.task_id }
})
