import { randomUUID } from 'node:crypto'
import {
  withActionContext,
  submitAction,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { loadIntakeForm } from '../templates/loader.js'
import { tryCreateBookingEvent } from './google.js'
import { queueNotification } from './notifications.js'

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

export type WorkflowRoute = 'auto' | 'manual'

// A service kind = a workflow_definition row (definition data, not a table —
// WP1 seed). The intake form itself is a Phase 0 repo file resolved through
// the loader by the bound intake_form_id.
export interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  route: WorkflowRoute
  intakeFormId: string
  intakeSchema: IntakeSchema
  documents: string[]
  isActive: boolean
  sortOrder: number
  updatedAt: string
}

type WorkflowRow = {
  id: string
  kind_name: string
  display_name: string
  description: string | null
  transitions: {
    route?: string
    intake_form_id?: string
    documents?: string[]
    sort_order?: number
    [k: string]: unknown
  }
  status: string
  recorded_at: string
}

// Display order for the booking page's service selection (REQ-INTAKE-02) is now
// config-as-data: transitions.sort_order, backfilled for the seeded services in
// vertical migration 0010. A service with no sort_order sinks to the bottom
// (99) and ties break on kind_name for a stable order.
function sortOrderOf(r: WorkflowRow): number {
  return typeof r.transitions.sort_order === 'number' ? r.transitions.sort_order : 99
}

function mapRow(r: WorkflowRow): ServiceDefinition {
  const intakeFormId = r.transitions.intake_form_id ?? ''
  let intakeSchema: IntakeSchema = { sections: [] }
  try {
    intakeSchema = { sections: loadIntakeForm(intakeFormId).sections }
  } catch {
    // An unbound or unknown form id renders as an empty form rather than a 500;
    // the booking wizard treats zero sections as "nothing to ask".
  }
  return {
    id: r.id,
    serviceKey: r.kind_name,
    displayName: r.display_name,
    description: r.description,
    route: r.transitions.route === 'auto' ? 'auto' : 'manual',
    intakeFormId,
    intakeSchema,
    documents: Array.isArray(r.transitions.documents) ? r.transitions.documents : [],
    isActive: r.status === 'active',
    sortOrder: sortOrderOf(r),
    updatedAt: r.recorded_at,
  }
}

function compareServices(a: ServiceDefinition, b: ServiceDefinition): number {
  return a.sortOrder - b.sortOrder || a.serviceKey.localeCompare(b.serviceKey)
}

const WORKFLOW_COLS = `
  id, kind_name, display_name, description, transitions, status,
  to_char(recorded_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS recorded_at
`

// Bitemporal read discipline (exsto-query-substrate): current definitions only.
export async function listServices(ctx: ActionContext): Promise<ServiceDefinition[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND status = 'active' AND valid_to IS NULL
       ORDER BY kind_name`,
      [ctx.tenantId],
    )
    return res.rows.map(mapRow).sort(compareServices)
  })
}

export async function getService(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceDefinition | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    return r ? mapRow(r) : null
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Service Library (PR1): admin read + versioned writes.
// listServices / getService above stay active-only and unchanged so the public
// booking page only ever sees bookable services. The admin surface needs to see
// disabled ones too, so it can re-enable them.
// ───────────────────────────────────────────────────────────────────────────

// Admin list: the CURRENT row of every service (valid_to IS NULL), active OR
// deprecated. Deprecated history versions (valid_to set) are excluded — only the
// latest definition per service shows up.
export async function listServicesIncludingInactive(
  ctx: ActionContext,
): Promise<ServiceDefinition[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND valid_to IS NULL
       ORDER BY kind_name`,
      [ctx.tenantId],
    )
    return res.rows.map(mapRow).sort(compareServices)
  })
}

export interface CreateServiceInput {
  displayName: string
  description?: string | null
  route?: WorkflowRoute
  documents?: string[]
  sortOrder?: number
}

export interface UpdateServiceMetadataInput {
  serviceKey: string
  displayName: string
  description?: string | null
  route?: WorkflowRoute
  documents?: string[]
  sortOrder?: number
}

// Create a new service (metadata only — questionnaire/prompt editors are a
// later PR). Returns the freshly-created service definition.
export async function createService(
  ctx: ActionContext,
  input: CreateServiceInput,
): Promise<ServiceDefinition> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'enforcement',
    payload: {
      display_name: input.displayName,
      description: input.description ?? null,
      route: input.route,
      documents: input.documents,
      sort_order: input.sortOrder,
    },
  })
  const eff = res.effects[0] as { serviceKey: string }
  const created = await getService(ctx, eff.serviceKey)
  if (!created) throw new Error('Service create succeeded but the new row could not be read back.')
  return created
}

// Update metadata = a NEW immutable version (the handler seals the prior active
// row and inserts version+1). Operational transitions (intake_form_id, route,
// documents, on_transcript) carry forward verbatim unless overridden here.
export async function updateServiceMetadata(
  ctx: ActionContext,
  input: UpdateServiceMetadataInput,
): Promise<ServiceDefinition> {
  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: input.serviceKey,
      display_name: input.displayName,
      description: input.description ?? null,
      route: input.route,
      documents: input.documents,
      sort_order: input.sortOrder,
    },
  })
  const updated = await getService(ctx, input.serviceKey)
  if (!updated) throw new Error(`Service not found after update: ${input.serviceKey}`)
  return updated
}

// Enable/disable (no new version) — flips the current row's status. A disabled
// service drops out of the public listServices but its definition persists.
export async function setServiceActive(
  ctx: ActionContext,
  serviceKey: string,
  active: boolean,
): Promise<{ serviceKey: string; status: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.set_active',
    intentKind: 'adjustment',
    payload: { service_key: serviceKey, active },
  })
  return res.effects[0] as { serviceKey: string; status: string }
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

  // Booking is recorded through the Phase 0 vocabulary: intake.submit →
  // matter.open → booking.create, each its own audited action (WP1 kinds).
  // The slot race is settled inside the booking.create handler via a
  // transaction-scoped advisory lock on (tenant, slot).
  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: input.clientFullName,
      client_email: input.clientEmail,
      client_phone: input.clientPhone ?? null,
      client_company_name: input.clientCompanyName ?? null,
      service_key: input.serviceKey,
      intake_form_id: service?.intakeFormId ?? null,
      intake_responses: input.intakeResponses,
    },
  })
  const intakeEffects = (intake.effects[0] ?? {}) as {
    clientEntityId?: string
    questionnaireEntityId?: string
  }

  const opened = await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      matter_number: matterNumber,
      service_key: input.serviceKey,
      workflow_route: service?.route ?? 'manual',
      attribution_source: input.attributionSource ?? null,
      client_entity_id: intakeEffects.clientEntityId,
      questionnaire_entity_id: intakeEffects.questionnaireEntityId,
      intake_action_id: intake.actionId,
    },
  })

  let booked: ActionResult
  try {
    booked = await submitAction(ctx, {
      actionKindName: 'booking.create',
      intentKind: 'enforcement',
      payload: {
        matter_entity_id: matterEntityId,
        scheduled_at: input.scheduledAtIso,
        scheduled_end: input.scheduledEndIso ?? null,
        google_event_id: googleEvent?.eventId ?? null,
        google_event_url: googleEvent?.htmlLink ?? null,
        matter_open_action_id: opened.actionId,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('SLOT_TAKEN')) throw new Error(SLOT_TAKEN_MESSAGE)
    throw err
  }

  // Notifications (WP6, REQ-NOTIFY-01..03) — queued so the booking response
  // never waits on the Gmail API; failures retry in the worker.
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? ''
  const firstName = input.clientFullName.split(/\s+/)[0]
  const commonVars = {
    matter_entity_id: matterEntityId,
    matter_number: matterNumber,
    client_full_name: input.clientFullName,
    client_first_name: firstName,
    client_email: input.clientEmail,
    client_phone: input.clientPhone ?? null,
    service_key: input.serviceKey,
    service_label: serviceDisplayName,
    scheduled_at: input.scheduledAtIso,
    scheduled_at_label: new Date(input.scheduledAtIso).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
    matter_url: baseUrl ? `${baseUrl}/attorney/matters/${matterEntityId}` : null,
  }
  await queueNotification(ctx, {
    routeKindName: 'prospect_intake_confirmation',
    to: input.clientEmail,
    variables: commonVars,
  })
  await queueNotification(ctx, {
    routeKindName: 'prospect_booking_confirmation',
    to: input.clientEmail,
    variables: commonVars,
  })
  if ((service?.route ?? 'manual') === 'manual') {
    // Manual-workflow matters may lack auto-generation visibility — the
    // attorney email is their safety net (REQ-NOTIFY-02).
    await queueNotification(ctx, {
      routeKindName: 'attorney_manual_matter',
      variables: commonVars,
    })
  }

  return booked
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
