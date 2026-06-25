import { randomUUID } from 'node:crypto'
import {
  withActionContext,
  submitAction,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import {
  hasRepoTemplate,
  loadDraftingPrompt,
  loadIntakeForm,
  resolveRepoDocumentTemplate,
  type IntakeQuestionnaire,
} from '../templates/loader.js'
import { tryCreateBookingEvent } from './google.js'
import { queueNotification } from './notifications.js'
import { signBookingManageToken } from './bookingManageToken.js'
import type { GenerationMode } from './generateDraft.js'
import {
  deriveLifecycleFromService,
  validateLifecycle,
  type Lifecycle,
} from '../lifecycle/index.js'

export interface ServiceField {
  id: string
  label: string
  type: string
  required?: boolean
  // Humane-intake flags (Contract I, WP2.4). allow_unknown: the client may check
  // "I don't know" instead of answering (treated as an answer). ask_attorney: the
  // question is flagged for attorney follow-up. Both default absent/false.
  allow_unknown?: boolean
  ask_attorney?: boolean
  // Deprecated: per-field help text is no longer authored or shown to users
  // (WP2.4). Kept optional so legacy repo/config schemas still type-check on read.
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
// Cost of a service (beta sprint Obj 10). Money is a decimal STRING (ADR 0044):
// 'hourly' → amount is the hourly rate and hours is the estimated engagement
// length; 'fixed' → amount is the flat fee (hours is null).
export type ServiceCostType = 'hourly' | 'fixed'
export interface ServiceCost {
  type: ServiceCostType
  amount: string
  hours: number | null
}

// GenerationMode (how a service produces documents — 'template_merge' = the
// deterministic renderTemplate path, 'ai_draft' = opt-in AI) has its single
// definition in the drafting worker; re-use it here (imported above) so the
// barrel doesn't export the name twice (TS2308).

// Per-service booking config (Contract G, WP2.3). `enabled` offers the service for
// scheduling; `send_calendar_invite` controls the invite on booking; the slot is
// `duration_minutes` long. Stored under transitions.booking; null when never set.
export type BookingDuration = 15 | 30 | 45 | 60
export interface ServiceBooking {
  enabled: boolean
  send_calendar_invite: boolean
  duration_minutes: BookingDuration
}

export interface ServiceDefinition {
  id: string
  serviceKey: string
  displayName: string
  description: string | null
  route: WorkflowRoute
  intakeFormId: string
  intakeSchema: IntakeSchema
  documents: string[]
  cost: ServiceCost | null
  // Per-document-kind flat fees, accrued when that document is approved (Phase 2).
  // { [document_kind]: decimal-string }. Empty when none configured.
  documentFees: Record<string, string>
  generationMode: GenerationMode
  booking: ServiceBooking | null
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
    intake_schema?: IntakeSchema
    drafting?: DraftingConfig
    document_templates?: DocumentTemplateConfig
    cost?: { type?: string; amount?: string; hours?: number | null }
    document_fees?: Record<string, string>
    generation_mode?: string
    booking?: { enabled?: boolean; send_calendar_invite?: boolean; duration_minutes?: number }
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

// Resolve the questionnaire for a service from the three-tier fallback:
// in-app config → repo file → empty. Always returns a well-formed IntakeSchema.
function resolveIntakeSchema(
  configured: IntakeSchema | undefined,
  intakeFormId: string,
): IntakeSchema {
  if (configured && Array.isArray(configured.sections)) {
    return { sections: configured.sections }
  }
  try {
    return { sections: loadIntakeForm(intakeFormId).sections }
  } catch {
    return { sections: [] }
  }
}

// A money decimal string (ADR 0044): non-negative, up to 2 fractional digits.
const MONEY_RE = /^\d+(\.\d{1,2})?$/

// Resolve a stored cost config into a well-formed ServiceCost, or null when no
// (valid) cost is set. Defensive: a malformed stored value reads as "no cost".
function parseServiceCost(
  cost: { type?: string; amount?: string; hours?: number | null } | undefined,
): ServiceCost | null {
  if (!cost || (cost.type !== 'hourly' && cost.type !== 'fixed')) return null
  if (typeof cost.amount !== 'string' || !MONEY_RE.test(cost.amount)) return null
  return {
    type: cost.type,
    amount: cost.amount,
    hours: cost.type === 'hourly' && typeof cost.hours === 'number' ? cost.hours : null,
  }
}

// The four bookable slot lengths (Contract G, WP2.3).
const BOOKING_DURATIONS: readonly number[] = [15, 30, 45, 60]

// Resolve a stored generation_mode. Default is 'ai_draft' so the editor's
// read-out agrees with the drafting worker (which also defaults to AI) for rows
// that predate the field; an explicit 'template_merge' is the no-AI path. Both
// explicit values are preserved on write.
function parseGenerationMode(m: unknown): GenerationMode {
  return m === 'template_merge' ? 'template_merge' : 'ai_draft'
}

// Resolve a stored booking block into a well-formed ServiceBooking, or null when
// none is set. Defensive: an unknown/malformed duration snaps to 30 minutes.
function parseBooking(
  b: { enabled?: boolean; send_calendar_invite?: boolean; duration_minutes?: number } | undefined,
): ServiceBooking | null {
  if (!b || typeof b !== 'object') return null
  const dm =
    typeof b.duration_minutes === 'number' && BOOKING_DURATIONS.includes(b.duration_minutes)
      ? (b.duration_minutes as BookingDuration)
      : 30
  return {
    enabled: b.enabled === true,
    send_calendar_invite: b.send_calendar_invite === true,
    duration_minutes: dm,
  }
}

// Validate + normalize a cost patch (throws on a bad money string). Shared by the
// dedicated cost setter and the metadata save so both write an identical shape.
function normalizeCost(cost: ServiceCost | null | undefined): ServiceCost | null {
  if (!cost) return null
  if (cost.type !== 'hourly' && cost.type !== 'fixed') {
    throw new Error("cost.type must be 'hourly' or 'fixed'.")
  }
  if (!MONEY_RE.test(cost.amount)) {
    throw new Error('cost.amount must be a decimal string like "350.00" (ADR 0044).')
  }
  const hours = cost.type === 'hourly' && typeof cost.hours === 'number' ? cost.hours : null
  if (hours != null && (hours < 0 || !Number.isFinite(hours))) {
    throw new Error('cost.hours must be a non-negative number.')
  }
  return { type: cost.type, amount: cost.amount, hours }
}

// Read stored per-document-kind fees into a clean { kind: amount } map, dropping
// any malformed money string. Defensive: a non-object reads as no fees.
function parseDocumentFees(fees: Record<string, string> | undefined): Record<string, string> {
  if (!fees || typeof fees !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [kind, amount] of Object.entries(fees)) {
    if (typeof amount === 'string' && MONEY_RE.test(amount)) out[kind] = amount
  }
  return out
}

// Validate + normalize a document-fees patch (throws on a bad money string). An
// entry with an empty amount is dropped (clears that document kind's fee).
function normalizeDocumentFees(
  fees: Record<string, string> | null | undefined,
): Record<string, string> {
  if (!fees) return {}
  const out: Record<string, string> = {}
  for (const [kind, raw] of Object.entries(fees)) {
    const amount = (raw ?? '').trim()
    if (amount === '') continue
    if (!MONEY_RE.test(amount)) {
      throw new Error(
        `document fee for "${kind}" must be a decimal string like "250.00" (ADR 0044).`,
      )
    }
    out[kind] = amount
  }
  return out
}

// Validate + normalize a booking block (throws on a bad duration).
function normalizeBooking(b: ServiceBooking | null | undefined): ServiceBooking | null {
  if (!b) return null
  if (!BOOKING_DURATIONS.includes(b.duration_minutes)) {
    throw new Error('booking.duration_minutes must be one of 15, 30, 45, 60.')
  }
  return {
    enabled: b.enabled === true,
    send_calendar_invite: b.send_calendar_invite === true,
    duration_minutes: b.duration_minutes,
  }
}

// A doc kind named like a drafting-prompt artifact (e.g. "mutual_nda_drafting_prompt")
// is never a real deliverable. The build wizard is told never to author a separate
// "<kind>_drafting_prompt" document, but when a model slips and does, it pollutes the
// service's document list: the completeness check then demands a drafting prompt for
// the phantom kind too, so "needs a drafting prompt" shows twice and the service can't
// enable. Filter these everywhere `documents` is derived; propose_template rejects them
// at the source so they can't be created again.
export function isPromptArtifactDocKind(kind: string): boolean {
  return /drafting_prompt/i.test(kind)
}
export function realDocumentKinds(documents: unknown): string[] {
  return (Array.isArray(documents) ? documents : []).filter(
    (k): k is string => typeof k === 'string' && !isPromptArtifactDocKind(k),
  )
}

function mapRow(r: WorkflowRow): ServiceDefinition {
  const intakeFormId = r.transitions.intake_form_id ?? ''
  // Resolution order (PR2): in-app config (transitions.intake_schema) wins, so an
  // attorney's edits take effect immediately; otherwise fall back to the Phase-0
  // repo file bound by intake_form_id; otherwise an empty form (no 500). The
  // booking page treats zero sections as "nothing to ask".
  const intakeSchema = resolveIntakeSchema(r.transitions.intake_schema, intakeFormId)
  return {
    id: r.id,
    serviceKey: r.kind_name,
    displayName: r.display_name,
    description: r.description,
    route: r.transitions.route === 'auto' ? 'auto' : 'manual',
    intakeFormId,
    intakeSchema,
    documents: realDocumentKinds(r.transitions.documents),
    cost: parseServiceCost(r.transitions.cost),
    documentFees: parseDocumentFees(r.transitions.document_fees),
    generationMode: parseGenerationMode(r.transitions.generation_mode),
    booking: parseBooking(r.transitions.booking),
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
         AND kind_name NOT LIKE 'firm.%'
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

// The service's EFFECTIVE matter lifecycle as data (ADR 0045). Reads
// workflow_definition.states for the active version — so an attorney's edits take
// effect immediately — and falls back to DERIVING it from the service's route/booking
// when states is empty or invalid. The fallback makes the engine robust whether or
// not a service has been authored yet, and equals the backfilled data by construction
// (the equality invariant). Distinct from serviceLifecycle.getServiceLifecycle, which
// is the read-only authored-graph accessor ({graph,version}|null, no derive fallback)
// the builder/AI authoring path uses; this resolver is what the worker/engine read.
export async function resolveServiceLifecycle(
  ctx: ActionContext,
  serviceKey: string,
): Promise<Lifecycle | null> {
  const stored = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ states: unknown }>(
      `SELECT states FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND status = 'active' AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0]?.states
  })
  if (Array.isArray(stored) && stored.length > 0) {
    const lc = stored as Lifecycle
    if (validateLifecycle(lc).ok) return lc
    // A malformed stored graph should never drive the engine — fall through to derive.
  }
  const service = await getService(ctx, serviceKey)
  if (!service) return null
  return deriveLifecycleFromService({
    route: service.route,
    bookingEnabled: service.booking?.enabled === true,
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
         AND kind_name NOT LIKE 'firm.%'
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
  // Contract G (WP2.3): how documents are produced, and per-service booking config.
  // Omit a field to carry the prior version's value forward; pass null to clear
  // booking/cost. Written into transitions via the upsert handler's merge patch.
  generationMode?: GenerationMode
  booking?: ServiceBooking | null
  cost?: ServiceCost | null
  // Per-document-kind flat fees, { [document_kind]: decimal-string }. Replaces the
  // stored map; an empty amount clears that kind's fee.
  documentFees?: Record<string, string> | null
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
  // Only the operational keys the attorney touched go into the merge patch — an
  // omitted field carries the prior version's value forward (the handler starts
  // the merge from the prior row). generation_mode/booking/cost are validated
  // here so a malformed save is rejected before a new version is written.
  const transitionsPatch: Record<string, unknown> = {}
  if (input.generationMode !== undefined)
    transitionsPatch.generation_mode = parseGenerationMode(input.generationMode)
  if (input.booking !== undefined) transitionsPatch.booking = normalizeBooking(input.booking)
  if (input.cost !== undefined) transitionsPatch.cost = normalizeCost(input.cost)
  if (input.documentFees !== undefined)
    transitionsPatch.document_fees = normalizeDocumentFees(input.documentFees)

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
      ...(Object.keys(transitionsPatch).length > 0 ? { transitions_patch: transitionsPatch } : {}),
    },
  })
  const updated = await getService(ctx, input.serviceKey)
  if (!updated) throw new Error(`Service not found after update: ${input.serviceKey}`)
  return updated
}

// Enable/disable (no new version) — flips the current row's status. A disabled
// service drops out of the public listServices but its definition persists.
//
// Enabling (active=true) is GATED on completeness (PR4): the set_active handler
// loads the current row's transitions and rejects an enable when the service is
// not bookable yet (no questionnaire, or an auto-route service missing a drafting
// prompt + required slots for any document kind). Disabling is unconditional.
// The handler is the source of truth for the gate; serviceCompleteness below
// computes the same rules for the UI (so it can disable the Enable button and
// show what's missing before the click).
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

// Retire a service: seal it with no successor so it leaves every listing while
// its history is preserved (legal.service.retire). Used to clear leftover
// test-fixture service rows (Obj 12).
export async function retireService(
  ctx: ActionContext,
  serviceKey: string,
): Promise<{ serviceKey: string; retired: boolean }> {
  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.retire',
    intentKind: 'correction',
    payload: { service_key: serviceKey },
  })
  return res.effects[0] as { serviceKey: string; retired: boolean }
}

// Clone a service: a faithful copy of the source's full transitions config
// (intake schema, drafting prompts, document templates, cost, booking, route,
// generation mode) under a brand-new key. The upsert handler slugifies the new
// display name into a unique kind_name and — like every freshly created service —
// starts it DISABLED, so the attorney reviews and explicitly enables the copy.
export async function cloneService(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceDefinition> {
  const src = await withActionContext(ctx, async (client) => {
    const res = await client.query<{
      display_name: string
      description: string | null
      transitions: Record<string, unknown>
    }>(
      `SELECT display_name, description, transitions
         FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0] ?? null
  })
  if (!src) throw new Error(`Service not found: ${serviceKey}`)

  const res = await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'enforcement',
    payload: {
      // No service_key → the handler creates a new one from this name.
      display_name: `${src.display_name} (copy)`,
      description: src.description,
      sort_order: 99, // sink the copy to the bottom of the list
      transitions_patch: src.transitions,
    },
  })
  const eff = res.effects[0] as { serviceKey: string }
  const created = await getService(ctx, eff.serviceKey)
  if (!created) throw new Error('Service clone succeeded but the new row could not be read back.')
  return created
}

export interface SetServiceCostInput {
  serviceKey: string
  // Omit or pass null to clear the cost.
  cost?: ServiceCost | null
}

// Set (or clear) a service's cost. Validates the money decimal string (ADR 0044)
// and writes it into transitions.cost via a new immutable version (the upsert
// handler seals the prior row). Clearing passes cost:null through the patch.
export async function setServiceCost(
  ctx: ActionContext,
  input: SetServiceCostInput,
): Promise<ServiceDefinition> {
  const existing = await getService(ctx, input.serviceKey)
  if (!existing) throw new Error(`Service not found: ${input.serviceKey}`)

  const costPatch = normalizeCost(input.cost)

  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: input.serviceKey,
      display_name: existing.displayName,
      transitions_patch: { cost: costPatch },
    },
  })
  const updated = await getService(ctx, input.serviceKey)
  if (!updated) throw new Error('Service cost saved but the new row could not be read back.')
  return updated
}

// ───────────────────────────────────────────────────────────────────────────
// Completeness gate (PR4). A service is not bookable until it is complete; the
// set_active handler enforces this on enable, and the attorney UI reads this to
// gate the "Enable service" button. The rules MUST match the handler guard
// (serviceLibrary.ts) so the UI never offers an enable that the handler rejects.
//
// The gate is deliberately CONFIG-SPECIFIC — it inspects transitions.intake_schema
// and transitions.drafting.prompts[kind], NOT the repo-file fallbacks. A service
// is "complete" only when the attorney has authored these in-app; the bundled
// repo defaults are a rendering safety net, not a substitute for explicit setup
// (and the repo drafting prompt is the same single file for every kind, so it
// could never prove a per-kind prompt exists). Rules:
//  1. transitions.intake_schema must be non-empty — ≥1 section with ≥1 field.
//  2. If route === 'auto', then for EVERY document kind in transitions.documents
//     there must be a transitions.drafting.prompts[kind] containing all
//     REQUIRED_DRAFTING_SLOTS. An auto service with no documents has nothing to
//     draft, which also fails.
// ───────────────────────────────────────────────────────────────────────────

export interface ServiceCompleteness {
  serviceKey: string
  ready: boolean
  // Human-readable reasons the service is not yet enableable. Empty when ready.
  missing: string[]
}

// True when an intake schema has at least one section carrying at least one field.
function intakeSchemaHasFields(schema: IntakeSchema | undefined): boolean {
  if (!schema || !Array.isArray(schema.sections)) return false
  return schema.sections.some((s) => Array.isArray(s.fields) && s.fields.length > 0)
}

// Pure completeness check over the CONFIG inputs (the in-app authored values).
// Shared shape so the handler (which reads transitions directly) and this API path
// produce identical reasons. promptByKind carries the CONFIG prompt text per kind
// (transitions.drafting.prompts[kind]); null when the attorney hasn't authored one.
export function computeCompleteness(args: {
  serviceKey: string
  route: WorkflowRoute
  documents: string[]
  intakeSchema: IntakeSchema | undefined
  promptByKind: Record<string, string | null>
  // Per-kind body-template availability: 'config' (authored in-app), 'repo' (a
  // bundled body ships for the kind), or 'none'. Optional: when a kind is absent,
  // it defaults to 'repo' if the kind has a bundled body, else 'none' — so callers
  // that predate the document-template editor (e.g. older completeness tests) still
  // get the right answer for the bundled kinds without threading the map through.
  templateByKind?: Record<string, 'config' | 'repo' | 'none'>
}): ServiceCompleteness {
  const missing: string[] = []

  if (!intakeSchemaHasFields(args.intakeSchema)) {
    missing.push('needs a questionnaire (at least one section with one field)')
  }

  if (args.route === 'auto') {
    if (args.documents.length === 0) {
      missing.push('auto-route service needs at least one document to draft')
    }
    for (const kind of args.documents) {
      // Drafting prompt: present and carrying all required slots.
      const text = args.promptByKind[kind] ?? null
      if (!text || !text.trim()) {
        missing.push(`needs a drafting prompt for "${kind}"`)
      } else {
        const slots = missingDraftingSlots(text)
        if (slots.length > 0) {
          missing.push(`drafting prompt for "${kind}" is missing slot(s): ${slots.join(', ')}`)
        }
      }
      // Document BODY template: an in-app config template OR a bundled repo body.
      // A novel kind (no bundled body) cannot be drafted until a template is
      // authored — otherwise the worker would have no document to fill.
      const tplSource = args.templateByKind?.[kind] ?? (hasRepoTemplate(kind) ? 'repo' : 'none')
      if (tplSource === 'none') {
        missing.push(`needs a document template for "${kind}"`)
      }
    }
  }

  return { serviceKey: args.serviceKey, ready: missing.length === 0, missing }
}

// Compute completeness for a service by reading its current definition's
// transitions row directly. Returns ready=false with a "service not found" reason
// for an unknown key (so the UI can surface it without throwing).
export async function serviceCompleteness(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceCompleteness> {
  const transitions = await withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0]?.transitions ?? null
  })
  if (!transitions) {
    return { serviceKey, ready: false, missing: [`Service not found: ${serviceKey}`] }
  }
  return completenessFromTransitions(serviceKey, transitions)
}

// Synchronous completeness over a raw transitions object — the form the set_active
// HANDLER has in hand (it reads the row's transitions directly). This is the
// single source of truth for the enable gate: both the UI path
// (serviceCompleteness) and the handler guard call it, so they can never disagree.
export function completenessFromTransitions(
  serviceKey: string,
  transitions: {
    route?: string
    documents?: string[]
    intake_schema?: IntakeSchema
    drafting?: DraftingConfig
    document_templates?: DocumentTemplateConfig
  },
): ServiceCompleteness {
  const route: WorkflowRoute = transitions.route === 'auto' ? 'auto' : 'manual'
  // Drop phantom "<kind>_drafting_prompt" doc kinds so they can't demand their own
  // drafting prompt (the "needs a drafting prompt" twice bug) or block enablement.
  const documents = realDocumentKinds(transitions.documents)

  const promptByKind: Record<string, string | null> = {}
  const templateByKind: Record<string, 'config' | 'repo' | 'none'> = {}
  if (route === 'auto') {
    const prompts = transitions.drafting?.prompts ?? {}
    const templates = transitions.document_templates?.templates ?? {}
    for (const kind of documents) {
      const t = prompts[kind]
      promptByKind[kind] = typeof t === 'string' ? t : null
      const tpl = templates[kind]
      templateByKind[kind] =
        typeof tpl === 'string' && tpl.trim() ? 'config' : hasRepoTemplate(kind) ? 'repo' : 'none'
    }
  }

  return computeCompleteness({
    serviceKey,
    route,
    documents,
    intakeSchema: transitions.intake_schema,
    promptByKind,
    templateByKind,
  })
}

// ───────────────────────────────────────────────────────────────────────────
// Questionnaire editor (PR2): read + versioned write of a service's intake form.
//
// The questionnaire is config-as-data living in transitions.intake_schema. A
// write is just a service upsert with a transitions_patch — the same versioned
// path metadata edits use (seal prior active row, insert version+1, record a
// configuration_change). No new action kind. The public booking page reads the
// resolved schema through mapRow's in-app-config-first fallback.
// ───────────────────────────────────────────────────────────────────────────

// The exact field types the public FieldRenderer (apps/legal-demo/app/book) and
// validateIntake understand. The editor emits ONLY these — anything else would
// silently fall through to a plain text input on the booking page. members_repeater
// carries memberFields + minItems; select carries options.
export const KNOWN_FIELD_TYPES = [
  'text',
  'textarea',
  'select',
  // Boolean answers. yes_no / true_false render as a two-choice control; the
  // stored answer is the chosen label ("Yes"/"No", "True"/"False").
  'yes_no',
  'true_false',
  // Multi-select from a choice list, rendered as toggle pills; the stored answer
  // is a string[] (template merge joins it per the template's format option).
  'checkbox',
  'date',
  'number',
  'address_autocomplete',
  'members_repeater',
] as const

export type KnownFieldType = (typeof KNOWN_FIELD_TYPES)[number]

const KNOWN_FIELD_TYPE_SET = new Set<string>(KNOWN_FIELD_TYPES)

// The full questionnaire shape (FIXED contract). The repo files and the in-app
// config both conform to this; the editor saves exactly this shape.
export interface QuestionnaireDoc {
  id: string
  version: number
  title: string
  description?: string
  jurisdiction?: string
  sections: ServiceSection[]
}

// Pure questionnaire resolver shared by getQuestionnaire and the completeness
// gate (the handler reuses this so its enable guard applies the SAME config→repo
// resolution as the API). Returns null when nothing resolves. Side-effect-free.
export function resolveQuestionnaireDoc(
  transitions: { intake_schema?: IntakeSchema; intake_form_id?: string } | undefined,
  serviceKey: string,
): QuestionnaireDoc | null {
  const configured = transitions?.intake_schema
  if (configured && Array.isArray(configured.sections)) {
    return normalizeDoc(configured as Partial<QuestionnaireDoc>, serviceKey)
  }
  const intakeFormId = transitions?.intake_form_id ?? ''
  try {
    const form: IntakeQuestionnaire = loadIntakeForm(intakeFormId)
    return normalizeDoc(form, serviceKey)
  } catch {
    return null
  }
}

// Read a service's questionnaire: in-app config (transitions.intake_schema) wins;
// else the bound repo file; else null when nothing is bound. Returns the full doc
// shape (id/version/title/sections), not just sections, so the editor can round-trip
// the header fields.
export async function getQuestionnaire(
  ctx: ActionContext,
  serviceKey: string,
): Promise<QuestionnaireDoc | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    if (!r) return null
    return resolveQuestionnaireDoc(r.transitions, serviceKey)
  })
}

// Every field id in a service's current questionnaire (lower-cased), including the
// member fields of a members_repeater (those bind tokens too). The set a document
// template's {{tokens}} are checked against for the variable contract (the build
// wizard's orphan-token detection). Empty when the service has no questionnaire.
export async function collectQuestionnaireFieldIds(
  ctx: ActionContext,
  serviceKey: string,
): Promise<string[]> {
  const schema = await getQuestionnaire(ctx, serviceKey)
  if (!schema) return []
  const ids: string[] = []
  const seen = new Set<string>()
  const visit = (fields: ServiceField[] | undefined): void => {
    for (const f of fields ?? []) {
      const id = (f.id ?? '').toLowerCase()
      if (id && !seen.has(id)) {
        seen.add(id)
        ids.push(id)
      }
      if (f.memberFields) visit(f.memberFields)
    }
  }
  for (const s of schema.sections ?? []) visit(s.fields)
  return ids
}

// Coerce a partial/loaded doc into the full QuestionnaireDoc shape. The id/version
// defaults keep the booking page and downstream readers happy even when an edited
// schema omitted the header fields.
function normalizeDoc(
  doc: Partial<QuestionnaireDoc> & { sections?: unknown },
  serviceKey: string,
): QuestionnaireDoc {
  return {
    id: typeof doc.id === 'string' && doc.id ? doc.id : serviceKey,
    version: typeof doc.version === 'number' ? doc.version : 1,
    title: typeof doc.title === 'string' ? doc.title : '',
    description: typeof doc.description === 'string' ? doc.description : undefined,
    jurisdiction: typeof doc.jurisdiction === 'string' ? doc.jurisdiction : undefined,
    sections: Array.isArray(doc.sections) ? (doc.sections as ServiceSection[]) : [],
  }
}

// Validate an intake schema against the FIXED contract before persisting. Throws a
// descriptive Error on the first problem (the editor surfaces .message). This is a
// write-path guard only — reads never validate, so legacy repo forms with extra
// field types still render.
export function validateIntakeSchema(schema: unknown): QuestionnaireDoc {
  if (!schema || typeof schema !== 'object') {
    throw new Error('Questionnaire must be an object.')
  }
  const doc = schema as Record<string, unknown>
  if (!Array.isArray(doc.sections)) {
    throw new Error('Questionnaire must have a sections array.')
  }
  if (doc.title !== undefined && typeof doc.title !== 'string') {
    throw new Error('Questionnaire title must be a string.')
  }
  const seenSection = new Set<string>()
  for (const [si, rawSection] of (doc.sections as unknown[]).entries()) {
    if (!rawSection || typeof rawSection !== 'object') {
      throw new Error(`Section ${si + 1} must be an object.`)
    }
    const section = rawSection as Record<string, unknown>
    if (typeof section.id !== 'string' || !section.id.trim()) {
      throw new Error(`Section ${si + 1} needs a non-empty id.`)
    }
    if (seenSection.has(section.id)) {
      throw new Error(`Duplicate section id: ${section.id}`)
    }
    seenSection.add(section.id)
    if (typeof section.title !== 'string') {
      throw new Error(`Section ${section.id} needs a title.`)
    }
    if (!Array.isArray(section.fields)) {
      throw new Error(`Section ${section.id} must have a fields array.`)
    }
    for (const rawField of section.fields as unknown[]) {
      validateField(rawField, section.id)
    }
  }
  return schema as QuestionnaireDoc
}

function validateField(rawField: unknown, sectionId: string): void {
  if (!rawField || typeof rawField !== 'object') {
    throw new Error(`A field in section ${sectionId} must be an object.`)
  }
  const field = rawField as Record<string, unknown>
  if (typeof field.id !== 'string' || !field.id.trim()) {
    throw new Error(`A field in section ${sectionId} needs a non-empty id.`)
  }
  if (typeof field.label !== 'string') {
    throw new Error(`Field ${field.id} needs a label.`)
  }
  if (typeof field.type !== 'string' || !KNOWN_FIELD_TYPE_SET.has(field.type)) {
    throw new Error(
      `Field ${field.id} has an unsupported type "${String(field.type)}". ` +
        `Allowed: ${KNOWN_FIELD_TYPES.join(', ')}.`,
    )
  }
  if (field.type === 'select' || field.type === 'checkbox') {
    if (!Array.isArray(field.options) || field.options.length === 0) {
      throw new Error(`${field.type} field ${field.id} needs a non-empty options array.`)
    }
    if (!(field.options as unknown[]).every((o) => typeof o === 'string')) {
      throw new Error(`${field.type} field ${field.id} options must all be strings.`)
    }
  }
  if (field.type === 'members_repeater') {
    if (!Array.isArray(field.memberFields) || field.memberFields.length === 0) {
      throw new Error(`Members field ${field.id} needs a non-empty memberFields array.`)
    }
    for (const sub of field.memberFields as unknown[]) {
      validateField(sub, `${sectionId}.${field.id}`)
    }
  }
}

// Write a service's questionnaire as a new immutable version. Validates the shape
// (throws on the first problem), reads the current display_name (the upsert
// requires it and preserves the rest of transitions), then submits the upsert with
// a transitions_patch carrying intake_schema. Returns the saved doc.
export async function updateQuestionnaire(
  ctx: ActionContext,
  serviceKey: string,
  intakeSchema: unknown,
): Promise<QuestionnaireDoc> {
  const validated = validateIntakeSchema(intakeSchema)
  const current = await getService(ctx, serviceKey)
  if (!current) throw new Error(`Service not found: ${serviceKey}`)

  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: serviceKey,
      display_name: current.displayName,
      transitions_patch: { intake_schema: validated },
    },
  })

  const saved = await getQuestionnaire(ctx, serviceKey)
  if (!saved) throw new Error(`Questionnaire not found after update: ${serviceKey}`)
  return saved
}

// ───────────────────────────────────────────────────────────────────────────
// Drafting-prompt editor (PR3): read + versioned write of a service's drafting
// prompt, PER DOCUMENT KIND.
//
// The drafting prompt is config-as-data living in transitions.drafting.prompts
// keyed by document kind (operating_agreement, engagement_letter, …). A write is
// just a service upsert with a transitions_patch — the same versioned path the
// metadata and questionnaire editors use (seal prior active row, insert
// version+1, record a configuration_change). No new action kind. The drafting
// worker (generateDraft) reads the resolved prompt through resolveDraftingPrompt,
// config-first with a repo-file fallback.
//
// The prompt is fed to assembleDraftingPrompt, which fills three mustache slots.
// An edited prompt MUST contain all of them or drafting silently breaks, so the
// write path validates their presence before persisting. This is the FIXED slot
// contract — it mirrors the .replace() calls in generateDraft.assembleDraftingPrompt.
// ───────────────────────────────────────────────────────────────────────────

// The mustache slots assembleDraftingPrompt fills (generateDraft.ts). EVERY stored
// prompt must contain all three; the document-body slot is named
// {{operating_agreement_template}} regardless of document kind (the worker fills
// that one slot with whichever body template the kind maps to).
export const REQUIRED_DRAFTING_SLOTS = [
  '{{questionnaire_responses_json}}',
  '{{transcript_text}}',
  '{{operating_agreement_template}}',
] as const

export interface DraftingConfig {
  prompt_version?: number
  prompts?: Record<string, string>
}

export interface DraftingPromptDoc {
  serviceKey: string
  documentKind: string
  // The resolved prompt text. Null when neither config nor a repo file yields one.
  promptText: string | null
  // 'config' when it came from transitions.drafting.prompts; 'repo' when it fell
  // back to the bundled drafting-prompt.md; 'none' when nothing resolved.
  source: 'config' | 'repo' | 'none'
  // The config prompt_version when source === 'config'; null otherwise.
  promptVersion: number | null
  // The required mustache slots, for the editor's checklist.
  requiredSlots: readonly string[]
}

// Which required slots a prompt is MISSING. Empty array = valid.
export function missingDraftingSlots(promptText: string): string[] {
  return REQUIRED_DRAFTING_SLOTS.filter((slot) => !promptText.includes(slot))
}

// Read a service's drafting prompt for one document kind. Resolution order:
// in-app config (transitions.drafting.prompts[documentKind]) → repo file
// (loadDraftingPrompt) → null. Returns a doc carrying the source + version so the
// editor can show provenance and the worker can record it.
export async function getDraftingPrompt(
  ctx: ActionContext,
  serviceKey: string,
  documentKind: string,
): Promise<DraftingPromptDoc | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    if (!r) return null
    return resolveDraftingPromptDoc(r.transitions.drafting, serviceKey, documentKind)
  })
}

// Pure resolver shared by getDraftingPrompt and the drafting worker: config wins,
// else the repo file, else null. Kept side-effect-free so generateDraft can reuse
// it without a second DB round-trip (it already has the service's transitions in
// hand via the matter's service config).
export function resolveDraftingPromptDoc(
  drafting: DraftingConfig | undefined,
  serviceKey: string,
  documentKind: string,
): DraftingPromptDoc {
  const configured = drafting?.prompts?.[documentKind]
  if (typeof configured === 'string' && configured.trim()) {
    return {
      serviceKey,
      documentKind,
      promptText: configured,
      source: 'config',
      promptVersion: typeof drafting?.prompt_version === 'number' ? drafting.prompt_version : null,
      requiredSlots: REQUIRED_DRAFTING_SLOTS,
    }
  }
  try {
    return {
      serviceKey,
      documentKind,
      promptText: loadDraftingPrompt(),
      source: 'repo',
      promptVersion: null,
      requiredSlots: REQUIRED_DRAFTING_SLOTS,
    }
  } catch {
    return {
      serviceKey,
      documentKind,
      promptText: null,
      source: 'none',
      promptVersion: null,
      requiredSlots: REQUIRED_DRAFTING_SLOTS,
    }
  }
}

// Validate a drafting prompt against the FIXED slot contract before persisting.
// Throws a descriptive Error naming the missing slots (the editor surfaces
// .message). Reads never validate — a legacy repo prompt always renders.
export function validateDraftingPrompt(promptText: unknown): string {
  if (typeof promptText !== 'string' || !promptText.trim()) {
    throw new Error('The drafting prompt must be non-empty text.')
  }
  const missing = missingDraftingSlots(promptText)
  if (missing.length > 0) {
    throw new Error(
      `The drafting prompt is missing required slot(s): ${missing.join(', ')}. ` +
        `Every prompt must contain ${REQUIRED_DRAFTING_SLOTS.join(', ')} so the worker can fill them.`,
    )
  }
  return promptText
}

// Write a service's drafting prompt for one document kind as a new immutable
// version. Validates the required slots are present (throws otherwise), reads the
// current row to MERGE into the existing drafting config (so other document kinds'
// prompts survive), bumps drafting.prompt_version, and submits the upsert with a
// transitions_patch. Returns the saved doc.
export async function updateDraftingPrompt(
  ctx: ActionContext,
  serviceKey: string,
  documentKind: string,
  promptText: unknown,
): Promise<DraftingPromptDoc> {
  if (!documentKind || typeof documentKind !== 'string') {
    throw new Error('A document kind is required.')
  }
  const validated = validateDraftingPrompt(promptText)

  const row = await withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0] ?? null
  })
  if (!row) throw new Error(`Service not found: ${serviceKey}`)

  // Merge into the existing drafting config so sibling document kinds' prompts are
  // preserved. Bump prompt_version on every save (a new version of the prompt set).
  const existing: DraftingConfig = row.transitions.drafting ?? {}
  const nextVersion =
    (typeof existing.prompt_version === 'number' ? existing.prompt_version : 0) + 1
  const mergedDrafting: DraftingConfig = {
    prompt_version: nextVersion,
    prompts: { ...(existing.prompts ?? {}), [documentKind]: validated },
  }

  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: serviceKey,
      display_name: row.display_name,
      transitions_patch: { drafting: mergedDrafting },
    },
  })

  const saved = await getDraftingPrompt(ctx, serviceKey, documentKind)
  if (!saved) throw new Error(`Drafting prompt not found after update: ${serviceKey}`)
  return saved
}

// ───────────────────────────────────────────────────────────────────────────
// Document-template editor (Doc-Types PR1) — the LAST service binding to move
// from repo file to config-as-data, PER DOCUMENT KIND. This is what lets an
// attorney stand up a brand-new document type (NDA, amendment, opposing-counsel
// letter) with no code change.
//
// The body template lives in transitions.document_templates.templates[<kind>],
// exactly parallel to the drafting prompt in transitions.drafting.prompts[<kind>].
// A write is a service upsert with a transitions_patch — the same versioned path
// (seal prior active row, insert version+1, record a configuration_change). No new
// action kind. The drafting worker (generateDraft) resolves the body through the
// same resolveDocumentTemplateDoc, config-first with a bundled repo fallback for
// the two Phase-0 kinds (operating_agreement / engagement_letter).
//
// Unlike the drafting prompt there is NO required-slot contract: the body template
// is a reference the model follows, and any {{variable}} markers inside it are
// filled by the model from the questionnaire/transcript, not by code. Validation is
// therefore just "non-empty text".
// ───────────────────────────────────────────────────────────────────────────

export interface DocumentTemplateConfig {
  template_version?: number
  templates?: Record<string, string>
}

export interface DocumentTemplateDoc {
  serviceKey: string
  documentKind: string
  // The resolved body template. Null when neither config nor a bundled repo body
  // yields one (a novel kind the attorney has not authored yet).
  templateText: string | null
  // 'config' when it came from transitions.document_templates; 'repo' when it fell
  // back to a bundled body file; 'none' when nothing resolved.
  source: 'config' | 'repo' | 'none'
  // The config template_version when source === 'config'; null otherwise.
  templateVersion: number | null
}

// Pure resolver shared by getDocumentTemplate and the drafting worker: config wins,
// else the bundled repo body (service-aware for the operating agreement), else null
// for a kind with neither. Side-effect-free apart from the cached repo file read, so
// generateDraft can reuse it without a second DB round-trip.
export function resolveDocumentTemplateDoc(
  documentTemplates: DocumentTemplateConfig | undefined,
  serviceKey: string,
  documentKind: string,
): DocumentTemplateDoc {
  const configured = documentTemplates?.templates?.[documentKind]
  if (typeof configured === 'string' && configured.trim()) {
    return {
      serviceKey,
      documentKind,
      templateText: configured,
      source: 'config',
      templateVersion:
        typeof documentTemplates?.template_version === 'number'
          ? documentTemplates.template_version
          : null,
    }
  }
  if (hasRepoTemplate(documentKind)) {
    return {
      serviceKey,
      documentKind,
      templateText: resolveRepoDocumentTemplate(documentKind, serviceKey),
      source: 'repo',
      templateVersion: null,
    }
  }
  return { serviceKey, documentKind, templateText: null, source: 'none', templateVersion: null }
}

// Read a service's body template for one document kind. Resolution order: in-app
// config (transitions.document_templates.templates[kind]) → bundled repo body →
// null. Returns null only when the SERVICE does not exist (a kind with no template
// still returns a doc with source 'none').
export async function getDocumentTemplate(
  ctx: ActionContext,
  serviceKey: string,
  documentKind: string,
): Promise<DocumentTemplateDoc | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    if (!r) return null
    return resolveDocumentTemplateDoc(r.transitions.document_templates, serviceKey, documentKind)
  })
}

// Validate a body template before persisting. The only rule is non-empty text;
// reads never validate, so a bundled repo body always renders.
export function validateDocumentTemplate(templateText: unknown): string {
  if (typeof templateText !== 'string' || !templateText.trim()) {
    throw new Error('The document template must be non-empty text.')
  }
  return templateText
}

// Write a service's body template for one document kind as a new immutable version.
// Validates non-empty, reads the current row to MERGE into the existing
// document_templates config (so other kinds' templates survive), bumps
// template_version, and submits the upsert with a transitions_patch. Returns the
// saved doc.
export async function updateDocumentTemplate(
  ctx: ActionContext,
  serviceKey: string,
  documentKind: string,
  templateText: unknown,
): Promise<DocumentTemplateDoc> {
  if (!documentKind || typeof documentKind !== 'string') {
    throw new Error('A document kind is required.')
  }
  const validated = validateDocumentTemplate(templateText)

  const row = await withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    return res.rows[0] ?? null
  })
  if (!row) throw new Error(`Service not found: ${serviceKey}`)

  const existing: DocumentTemplateConfig = row.transitions.document_templates ?? {}
  const nextVersion =
    (typeof existing.template_version === 'number' ? existing.template_version : 0) + 1
  const merged: DocumentTemplateConfig = {
    template_version: nextVersion,
    templates: { ...(existing.templates ?? {}), [documentKind]: validated },
  }

  await submitAction(ctx, {
    actionKindName: 'legal.service.upsert',
    intentKind: 'adjustment',
    payload: {
      service_key: serviceKey,
      display_name: row.display_name,
      transitions_patch: { document_templates: merged },
    },
  })

  const saved = await getDocumentTemplate(ctx, serviceKey, documentKind)
  if (!saved) throw new Error(`Document template not found after update: ${serviceKey}`)
  return saved
}

// A service's CONFIGURED body templates (transitions.document_templates) — one
// entry per document kind the attorney has authored, with the raw body. Read-only;
// used by the build-wizard's intake/template authoring to compute the variable
// contract (the {{tokens}} a questionnaire must cover). Only config-stored bodies
// are returned (repo-bundled fallbacks are not part of the firm's authored
// contract); empty array when the service has no configured templates.
export interface ServiceDocumentTemplate {
  documentKind: string
  body: string
}

export async function listServiceDocumentTemplates(
  ctx: ActionContext,
  serviceKey: string,
): Promise<ServiceDocumentTemplate[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<WorkflowRow>(
      `SELECT ${WORKFLOW_COLS}
       FROM workflow_definition
       WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL`,
      [ctx.tenantId, serviceKey],
    )
    const r = res.rows[0]
    if (!r) return []
    const templates = r.transitions.document_templates?.templates ?? {}
    return Object.entries(templates)
      .filter(([, body]) => typeof body === 'string' && body.trim())
      .map(([documentKind, body]) => ({ documentKind, body: body as string }))
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

export interface OpenMatterInput {
  clientFullName: string
  clientEmail: string
  clientCompanyName?: string
  serviceKey: string
}

// Open a matter MANUALLY (attorney-initiated, no booked consultation) — the
// walk-in / started-outside-the-portal path that the Matters page's "New matter"
// button uses. Mirrors the booking flow's intake.submit → matter.open, minus
// booking.create (there's no scheduled slot). Uses only the registered Phase-0
// actions; the matter id + number are server-generated exactly like a booked
// matter, and the client_contact + (empty) questionnaire are created via intake.
export async function openMatter(
  ctx: ActionContext,
  input: OpenMatterInput,
): Promise<{ matterEntityId: string; matterNumber: string }> {
  const matterEntityId = randomUUID()
  const matterNumber = `M-${Date.now().toString(36).toUpperCase()}`
  const service = await getService(ctx, input.serviceKey)

  const intake = await submitAction(ctx, {
    actionKindName: 'intake.submit',
    intentKind: 'enforcement',
    payload: {
      client_full_name: input.clientFullName,
      client_email: input.clientEmail,
      client_phone: null,
      client_company_name: input.clientCompanyName ?? null,
      service_key: input.serviceKey,
      intake_form_id: service?.intakeFormId ?? null,
      intake_responses: {},
    },
  })
  const intakeEffects = (intake.effects[0] ?? {}) as {
    clientEntityId?: string
    questionnaireEntityId?: string
  }

  await submitAction(ctx, {
    actionKindName: 'matter.open',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: matterEntityId,
      matter_number: matterNumber,
      service_key: input.serviceKey,
      workflow_route: service?.route ?? 'manual',
      attribution_source: 'attorney_manual',
      client_entity_id: intakeEffects.clientEntityId,
      questionnaire_entity_id: intakeEffects.questionnaireEntityId,
      intake_action_id: intake.actionId,
      client_display_name: input.clientCompanyName ?? input.clientFullName,
    },
  })

  return { matterEntityId, matterNumber }
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
      // Name the auto-created client-parent account after the company (when given)
      // else the person, so it reads sensibly in the CRM (intake linking salvage).
      client_display_name: input.clientCompanyName ?? input.clientFullName,
    },
  })

  let booked: ActionResult
  try {
    booked = await submitAction(ctx, {
      actionKindName: 'booking.create',
      intentKind: 'enforcement',
      payload: {
        matter_entity_id: matterEntityId,
        matter_number: matterNumber,
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
  // Self-service manage-link token (minted once, reused for reschedule + cancel).
  // Best-effort: if the signing secret is unset, the email simply omits the
  // manage buttons (the booking itself must never fail over a missing link).
  let manageToken: string | null = null
  if (baseUrl) {
    try {
      manageToken = signBookingManageToken({ matterEntityId, tenantId: ctx.tenantId })
    } catch (err) {
      console.error('[submitBooking] manage-link token not minted (booking still saved):', err)
    }
  }
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
    // Client account access (S10): magic-link portal sign-in. The prospect
    // booking confirmation email links here, pre-filled with the email they just
    // booked with, so "Create your account" lands them one click from a link.
    portal_url: baseUrl ? `${baseUrl}/portal/login` : null,
    account_url: baseUrl
      ? `${baseUrl}/portal/login?email=${encodeURIComponent(input.clientEmail)}`
      : null,
    // Self-service reschedule / cancel: one HMAC-signed, tenant-bound token gates
    // the public /book/manage page (exsto-public-surface). The page opens on
    // reschedule; ?intent=cancel jumps straight to the cancel panel.
    reschedule_url: manageToken ? `${baseUrl}/book/manage/${manageToken}` : null,
    cancel_url: manageToken ? `${baseUrl}/book/manage/${manageToken}?intent=cancel` : null,
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

  // Beta sprint Obj 6: auto-route services draft their documents AT SUBMIT, from
  // the questionnaire — no dependency on a consultation call. enqueueAutoDrafts is
  // a no-op for manual routes, and a post-call transcript still triggers a redraft
  // (granolaIngestion). Dynamic import avoids a cycle (granolaIngestion imports
  // services back). Best-effort: a drafting hiccup must not fail the booking.
  try {
    const { enqueueAutoDrafts } = await import('./granolaIngestion.js')
    await enqueueAutoDrafts(ctx, matterEntityId)
  } catch (err) {
    console.error('[submitBooking] auto-draft enqueue failed (booking still saved):', err)
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
