import { randomUUID } from 'node:crypto'
import {
  withActionContext,
  submitAction,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { tryCreateBookingEvent } from './google.js'

export interface ServiceField {
  id: string
  label: string
  type: string
  required?: boolean
  help?: string
  options?: string[]
  memberFields?: ServiceField[]
  minItems?: number
}

export interface ServiceSection {
  id: string
  title: string
  fields: ServiceField[]
}

export interface IntakeSchema {
  sections: ServiceSection[]
}

export type FeeModel = 'fixed' | 'hourly' | null

export interface ServiceLinkedTemplate {
  templateId: string
  templateKey: string
  displayName: string
  sortOrder: number
  autopopulate: boolean
}

export interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  intakeSchema: IntakeSchema
  isActive: boolean
  sortOrder: number
  updatedAt: string
  feeModel: FeeModel
  flatFeeUsd: number | null
  hourlyRateUsd: number | null
  estimatedHours: number | null
  defaultReferralPartnerId: string | null
  linkedTemplates: ServiceLinkedTemplate[]
}

type ServiceRow = {
  id: string
  service_key: string
  display_name: string
  description: string | null
  intake_schema: IntakeSchema
  is_active: boolean
  sort_order: number
  updated_at: string
  fee_model: 'fixed' | 'hourly' | null
  flat_fee_usd: string | null
  hourly_rate_usd: string | null
  estimated_hours: string | null
  default_referral_partner_id: string | null
}

type LinkRow = {
  service_id: string
  template_id: string
  template_key: string
  display_name: string
  sort_order: number
  autopopulate: boolean
}

const SERVICE_COLS = `
  id, service_key, display_name, description, intake_schema, is_active, sort_order,
  to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS updated_at,
  fee_model, flat_fee_usd, hourly_rate_usd, estimated_hours, default_referral_partner_id
`

function toNum(v: string | null): number | null {
  if (v === null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function mapRow(r: ServiceRow, links: ServiceLinkedTemplate[]): ServiceDefinition {
  return {
    id: r.id,
    serviceKey: r.service_key,
    displayName: r.display_name,
    description: r.description,
    intakeSchema: r.intake_schema,
    isActive: r.is_active,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
    feeModel: r.fee_model ?? null,
    flatFeeUsd: toNum(r.flat_fee_usd),
    hourlyRateUsd: toNum(r.hourly_rate_usd),
    estimatedHours: toNum(r.estimated_hours),
    defaultReferralPartnerId: r.default_referral_partner_id,
    linkedTemplates: links,
  }
}

async function fetchLinkedTemplates(
  client: { query: <T>(sql: string, params: unknown[]) => Promise<{ rows: T[] }> },
  tenantId: string,
  serviceIds: string[],
): Promise<Map<string, ServiceLinkedTemplate[]>> {
  if (serviceIds.length === 0) return new Map()
  const res = await client.query<LinkRow>(
    `SELECT sdt.service_id, sdt.template_id, dt.template_key, dt.display_name,
            sdt.sort_order, sdt.autopopulate
     FROM service_document_template sdt
     JOIN document_template dt ON dt.id = sdt.template_id
     WHERE sdt.tenant_id = $1 AND sdt.service_id = ANY($2)
     ORDER BY sdt.sort_order, dt.display_name`,
    [tenantId, serviceIds],
  )
  const grouped = new Map<string, ServiceLinkedTemplate[]>()
  for (const row of res.rows) {
    const list = grouped.get(row.service_id) ?? []
    list.push({
      templateId: row.template_id,
      templateKey: row.template_key,
      displayName: row.display_name,
      sortOrder: row.sort_order,
      autopopulate: row.autopopulate,
    })
    grouped.set(row.service_id, list)
  }
  return grouped
}

export async function listServices(ctx: ActionContext): Promise<ServiceDefinition[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<ServiceRow>(
      `SELECT ${SERVICE_COLS}
       FROM service_definition
       WHERE tenant_id = $1 AND is_active = true
       ORDER BY sort_order, display_name`,
      [ctx.tenantId],
    )
    const linkMap = await fetchLinkedTemplates(
      client,
      ctx.tenantId,
      res.rows.map((r) => r.id),
    )
    return res.rows.map((r) => mapRow(r, linkMap.get(r.id) ?? []))
  })
}

export async function getService(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceDefinition | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<ServiceRow>(
      `SELECT ${SERVICE_COLS}
       FROM service_definition
       WHERE tenant_id = $1 AND service_key = $2`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    if (!r) return null
    const linkMap = await fetchLinkedTemplates(client, ctx.tenantId, [r.id])
    return mapRow(r, linkMap.get(r.id) ?? [])
  })
}

export interface UpdateServiceInput {
  serviceKey: string
  displayName?: string
  description?: string | null
  intakeSchema?: IntakeSchema
  isActive?: boolean
  // Pricing — pass undefined to leave unchanged, null to clear.
  feeModel?: FeeModel
  flatFeeUsd?: number | null
  hourlyRateUsd?: number | null
  estimatedHours?: number | null
  // Pass undefined to leave unchanged, null to clear.
  defaultReferralPartnerId?: string | null
}

export async function updateService(
  ctx: ActionContext,
  input: UpdateServiceInput,
): Promise<ServiceDefinition> {
  return withActionContext(ctx, async (client) => {
    // COALESCE with sentinel column types: jsonb for intakeSchema, simple
    // values for the rest. Where a field is undefined we use null + COALESCE
    // to leave the column alone; explicit nulls in input flow through as
    // genuine clears via a separate "clear flag" parameter for each nullable
    // field.
    const res = await client.query<ServiceRow>(
      `UPDATE service_definition
       SET display_name = COALESCE($3, display_name),
           description = CASE WHEN $4::boolean THEN $5 ELSE description END,
           intake_schema = COALESCE($6::jsonb, intake_schema),
           is_active = COALESCE($7, is_active),
           fee_model = CASE WHEN $8::boolean THEN $9 ELSE fee_model END,
           flat_fee_usd = CASE WHEN $10::boolean THEN $11 ELSE flat_fee_usd END,
           hourly_rate_usd = CASE WHEN $12::boolean THEN $13 ELSE hourly_rate_usd END,
           estimated_hours = CASE WHEN $14::boolean THEN $15 ELSE estimated_hours END,
           default_referral_partner_id = CASE WHEN $16::boolean THEN $17 ELSE default_referral_partner_id END,
           updated_at = now()
       WHERE tenant_id = $1 AND service_key = $2
       RETURNING ${SERVICE_COLS}`,
      [
        ctx.tenantId,
        input.serviceKey,
        input.displayName ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.intakeSchema ? JSON.stringify(input.intakeSchema) : null,
        input.isActive ?? null,
        input.feeModel !== undefined,
        input.feeModel ?? null,
        input.flatFeeUsd !== undefined,
        input.flatFeeUsd ?? null,
        input.hourlyRateUsd !== undefined,
        input.hourlyRateUsd ?? null,
        input.estimatedHours !== undefined,
        input.estimatedHours ?? null,
        input.defaultReferralPartnerId !== undefined,
        input.defaultReferralPartnerId ?? null,
      ],
    )
    const r = res.rows[0]
    if (!r) throw new Error(`Service not found: ${input.serviceKey}`)
    const linkMap = await fetchLinkedTemplates(client, ctx.tenantId, [r.id])
    return mapRow(r, linkMap.get(r.id) ?? [])
  })
}

// ── Template linkage ─────────────────────────────────────────────────────────

export interface AttachTemplateInput {
  serviceKey: string
  templateKey: string
  sortOrder?: number
  autopopulate?: boolean
}

export async function attachTemplate(
  ctx: ActionContext,
  input: AttachTemplateInput,
): Promise<void> {
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO service_document_template (tenant_id, service_id, template_id, sort_order, autopopulate)
       SELECT $1, s.id, t.id, COALESCE($4, 0), COALESCE($5, true)
       FROM service_definition s, document_template t
       WHERE s.tenant_id = $1 AND s.service_key = $2
         AND t.tenant_id = $1 AND t.template_key = $3
       ON CONFLICT (tenant_id, service_id, template_id) DO UPDATE
         SET sort_order = EXCLUDED.sort_order,
             autopopulate = EXCLUDED.autopopulate`,
      [
        ctx.tenantId,
        input.serviceKey,
        input.templateKey,
        input.sortOrder ?? null,
        input.autopopulate ?? null,
      ],
    )
  })
}

export interface DetachTemplateInput {
  serviceKey: string
  templateKey: string
}

export async function detachTemplate(
  ctx: ActionContext,
  input: DetachTemplateInput,
): Promise<void> {
  await withActionContext(ctx, async (client) => {
    await client.query(
      `DELETE FROM service_document_template sdt
       USING service_definition s, document_template t
       WHERE sdt.tenant_id = $1
         AND sdt.service_id = s.id AND s.service_key = $2
         AND sdt.template_id = t.id AND t.template_key = $3`,
      [ctx.tenantId, input.serviceKey, input.templateKey],
    )
  })
}

export interface SubmitBookingInput {
  clientFullName: string
  clientEmail: string
  clientPhone?: string
  clientCompanyName?: string
  attributionSource: string
  serviceKey: string
  intakeResponses: Record<string, unknown>
  scheduledAtIso: string
  scheduledEndIso?: string
  notionEventId?: string | null
}

// Returns true when the requested time window overlaps with an existing
// active matter's scheduled window. This is the substrate-level guard
// against double-booking — independent of Google freebusy, so it still
// works when Google is disconnected.
async function isSlotTaken(ctx: ActionContext, startIso: string, endIso: string): Promise<boolean> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ taken: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM entity e
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
         WHERE e.tenant_id = $1
           AND ekd.kind_name = 'matter'
           AND e.status = 'active'
           AND (e.metadata->>'scheduled_at') IS NOT NULL
           AND (e.metadata->>'scheduled_at')::timestamptz < $3::timestamptz
           AND COALESCE(
             (e.metadata->>'scheduled_end')::timestamptz,
             (e.metadata->>'scheduled_at')::timestamptz + interval '30 minutes'
           ) > $2::timestamptz
       ) AS taken`,
      [ctx.tenantId, startIso, endIso],
    )
    return res.rows[0]?.taken === true
  })
}

// Stable error code consumed by the frontend so it can render a translated
// "slot taken" message and refresh availability. Frontend matches on the
// `SLOT_TAKEN:` prefix; the suffix is the English fallback for any caller
// that doesn't translate.
const SLOT_TAKEN_MESSAGE = 'SLOT_TAKEN: That time slot was just booked. Please pick another time.'

// Pg unique violation. The 0015 migration adds matter_active_scheduled_at_unique
// as the final-arbiter check against a race that slips past the app-level
// isSlotTaken pre-check.
function isUniqueSlotViolation(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return (
    msg.includes('matter_active_scheduled_at_unique') ||
    (msg.includes('duplicate key') && msg.includes('scheduled_at'))
  )
}

export async function submitBooking(
  ctx: ActionContext,
  input: SubmitBookingInput,
): Promise<ActionResult> {
  // Conflict check FIRST, before any side effects. Throwing here means no
  // Google event is created, no matter row is written, and the client sees
  // a clear "pick another time" error.
  const requestedEnd = input.scheduledEndIso ?? input.scheduledAtIso
  if (await isSlotTaken(ctx, input.scheduledAtIso, requestedEnd)) {
    throw new Error(SLOT_TAKEN_MESSAGE)
  }

  // Pre-generate the matter id so the Google Calendar event description can
  // include a reschedule link that points back at this matter.
  const matterEntityId = randomUUID()
  const matterNumber = `M-${Date.now().toString(36).toUpperCase()}`
  const service = await getService(ctx, input.serviceKey)
  const serviceDisplayName = service?.displayName ?? input.serviceKey

  // Try to create the Google Calendar event first (sends invite emails via
  // sendUpdates:'all'). If Google isn't connected or fails, we still book the
  // matter — the calendar sync just won't happen.
  const intakeSummary = summarizeIntake(input.intakeResponses)
  const googleEvent = input.scheduledEndIso
    ? await tryCreateBookingEvent(ctx, {
        matterEntityId,
        matterNumber,
        clientFullName: input.clientFullName,
        clientEmail: input.clientEmail,
        serviceDisplayName,
        scheduledAtIso: input.scheduledAtIso,
        scheduledEndIso: input.scheduledEndIso,
        intakeSummary,
      })
    : null

  try {
    return await submitAction(ctx, {
      actionKindName: 'legal.booking.submit',
      intentKind: 'enforcement',
      payload: {
        matter_entity_id: matterEntityId,
        matter_number: matterNumber,
        client_full_name: input.clientFullName,
        client_email: input.clientEmail,
        client_phone: input.clientPhone ?? null,
        client_company_name: input.clientCompanyName ?? null,
        attribution_source: input.attributionSource,
        service_key: input.serviceKey,
        intake_responses: input.intakeResponses,
        scheduled_at: input.scheduledAtIso,
        scheduled_end: input.scheduledEndIso ?? null,
        notion_event_id: input.notionEventId ?? null,
        google_event_id: googleEvent?.eventId ?? null,
        google_event_url: googleEvent?.htmlLink ?? null,
      },
    })
  } catch (err) {
    // The DB unique index is the final arbiter when two simultaneous
    // submissions both pass the application-level isSlotTaken check.
    if (isUniqueSlotViolation(err)) {
      throw new Error(SLOT_TAKEN_MESSAGE)
    }
    throw err
  }
}

function summarizeIntake(responses: Record<string, unknown>): string {
  const lines: string[] = []
  for (const [k, v] of Object.entries(responses)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) {
      lines.push(`${k}: ${v.length} item(s)`)
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      lines.push(`${k}: ${String(v).slice(0, 120)}`)
    }
  }
  return lines.slice(0, 8).join('<br>')
}
