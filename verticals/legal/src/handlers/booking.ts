import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { closeOpenAttribute, insertAttribute, insertEvent, lookupKindId } from './common.js'
import { dispatchClientDelivery } from './clientDelivery.js'

// ───────────────────────────────────────────────────────────────────────────
// booking.create / booking.update / booking.cancel — consultation scheduling
// (REQ-INTAKE-05/06). The calendar event itself is created/updated/cancelled
// by the API layer through the Google adapter; these handlers record the
// substrate truth (attributes + lifecycle events) and arbitrate slot races.
// ───────────────────────────────────────────────────────────────────────────

const SLOT_TAKEN_MESSAGE = 'SLOT_TAKEN: That time slot was just booked. Please pick another time.'

// Transaction-scoped advisory lock on (tenant, slot start). Two concurrent
// bookings for the same slot serialize here; the second then fails the
// overlap re-check below. No DDL on core tables needed (the wedge's unique
// index lived in a wedge-only migration; vertical migrations must not touch
// the core entity table).
async function lockSlot(client: DbClient, tenantId: string, scheduledAtIso: string) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 42))`, [
    `${tenantId}|booking|${scheduledAtIso}`,
  ])
}

async function slotOverlaps(
  client: DbClient,
  tenantId: string,
  startIso: string,
  endIso: string,
  excludeMatterId?: string,
): Promise<boolean> {
  const res = await client.query<{ taken: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'matter'
         AND e.status = 'active'
         AND ($4::uuid IS NULL OR e.id <> $4::uuid)
         AND (e.metadata->>'scheduled_at') IS NOT NULL
         AND (e.metadata->>'scheduled_at')::timestamptz < $3::timestamptz
         AND COALESCE(
           (e.metadata->>'scheduled_end')::timestamptz,
           (e.metadata->>'scheduled_at')::timestamptz + interval '30 minutes'
         ) > $2::timestamptz
     ) AS taken`,
    [tenantId, startIso, endIso, excludeMatterId ?? null],
  )
  return res.rows[0]?.taken === true
}

async function writeScheduleAttrs(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    matterEntityId: string
    scheduledAt: string
    scheduledEnd: string | null
    googleEventId: string | null
  },
) {
  const attrs: Array<{ kind: string; value: unknown }> = [
    { kind: 'scheduled_at', value: args.scheduledAt },
  ]
  if (args.scheduledEnd) attrs.push({ kind: 'scheduled_end', value: args.scheduledEnd })
  if (args.googleEventId) attrs.push({ kind: 'google_event_id', value: args.googleEventId })
  attrs.push({ kind: 'matter_status', value: 'consultation_booked' })

  for (const a of attrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, a.kind)
    // matter_status is single-valued lifecycle state: supersede the prior open row
    // so the read path (latest open) resolves one value, not a stack (WF-FIX-2 #1).
    if (a.kind === 'matter_status') {
      await closeOpenAttribute(client, args.tenantId, args.matterEntityId, akId)
    }
    await insertAttribute(client, {
      tenantId: args.tenantId,
      actionId: args.actionId,
      entityId: args.matterEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: 1.0,
      timePrecision: a.kind.startsWith('scheduled') ? 'minute' : 'exact_instant',
      sourceType: 'human',
      sourceRef: args.actorId,
    })
  }
}

interface BookingCreatePayload {
  matter_entity_id: string
  // The human-facing matter reference (entity name), echoed back in the effect so
  // the booking-confirmation page can show it (it reads effects[0].matterNumber).
  matter_number?: string
  scheduled_at: string
  scheduled_end: string | null
  google_event_id: string | null
  google_event_url: string | null
  matter_open_action_id?: string
}

registerActionHandler('booking.create', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as BookingCreatePayload
  const end = p.scheduled_end ?? p.scheduled_at

  await lockSlot(client, ctx.tenantId, p.scheduled_at)
  if (await slotOverlaps(client, ctx.tenantId, p.scheduled_at, end, p.matter_entity_id)) {
    throw new Error(SLOT_TAKEN_MESSAGE)
  }

  // Scheduling metadata mirrors onto the matter entity so the overlap guard
  // and dashboards read one place; attribute rows carry the provenanced history.
  await client.query(
    `UPDATE entity SET metadata = metadata || $3::jsonb
     WHERE tenant_id = $1 AND id = $2`,
    [
      ctx.tenantId,
      p.matter_entity_id,
      JSON.stringify({
        scheduled_at: p.scheduled_at,
        scheduled_end: p.scheduled_end,
        google_event_id: p.google_event_id,
        google_event_url: p.google_event_url,
      }),
    ],
  )

  await writeScheduleAttrs(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    matterEntityId: p.matter_entity_id,
    scheduledAt: p.scheduled_at,
    scheduledEnd: p.scheduled_end,
    googleEventId: p.google_event_id,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'consultation.booked',
    primaryEntityId: p.matter_entity_id,
    data: {
      scheduled_at: p.scheduled_at,
      scheduled_end: p.scheduled_end,
      google_event_id: p.google_event_id,
    },
    sourceRef: ctx.actorId,
  })

  // ADR 0046 — the client's OWN booking advances a matter parked at a client gate
  // whose edge is `via: 'booking.create'` (flag-guarded no-op otherwise).
  await dispatchClientDelivery(client, ctx, p.matter_entity_id, 'booking.create', actionId)

  return {
    matterEntityId: p.matter_entity_id,
    matterNumber: p.matter_number ?? null,
    scheduledAt: p.scheduled_at,
    googleEventId: p.google_event_id,
    googleEventUrl: p.google_event_url,
  }
})

interface BookingUpdatePayload {
  matter_entity_id: string
  scheduled_at: string
  scheduled_end: string | null
  google_event_id?: string | null
}

registerActionHandler('booking.update', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as BookingUpdatePayload
  const end = p.scheduled_end ?? p.scheduled_at

  await lockSlot(client, ctx.tenantId, p.scheduled_at)
  if (await slotOverlaps(client, ctx.tenantId, p.scheduled_at, end, p.matter_entity_id)) {
    throw new Error(SLOT_TAKEN_MESSAGE)
  }

  await client.query(
    `UPDATE entity SET metadata = metadata || $3::jsonb
     WHERE tenant_id = $1 AND id = $2`,
    [
      ctx.tenantId,
      p.matter_entity_id,
      JSON.stringify({ scheduled_at: p.scheduled_at, scheduled_end: p.scheduled_end }),
    ],
  )

  await writeScheduleAttrs(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    matterEntityId: p.matter_entity_id,
    scheduledAt: p.scheduled_at,
    scheduledEnd: p.scheduled_end,
    googleEventId: p.google_event_id ?? null,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'consultation.rescheduled',
    primaryEntityId: p.matter_entity_id,
    data: { scheduled_at: p.scheduled_at, scheduled_end: p.scheduled_end },
    sourceRef: ctx.actorId,
  })

  return { matterEntityId: p.matter_entity_id, scheduledAt: p.scheduled_at }
})

interface BookingCancelPayload {
  matter_entity_id: string
  reason?: string
}

registerActionHandler('booking.cancel', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as BookingCancelPayload

  // Clear the scheduling metadata so the slot frees for rebooking; attribute
  // history (append-only) retains when it had been scheduled.
  await client.query(
    `UPDATE entity SET metadata = metadata - 'scheduled_at' - 'scheduled_end' - 'google_event_id' - 'google_event_url'
     WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, p.matter_entity_id],
  )

  const statusKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_status',
  )
  await closeOpenAttribute(client, ctx.tenantId, p.matter_entity_id, statusKindId)
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: p.matter_entity_id,
    attributeKindId: statusKindId,
    value: 'consultation_cancelled',
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'consultation.cancelled',
    primaryEntityId: p.matter_entity_id,
    data: { reason: p.reason ?? null },
    sourceRef: ctx.actorId,
  })

  return { matterEntityId: p.matter_entity_id }
})
