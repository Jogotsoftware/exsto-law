// Public, token-gated "manage your appointment" operations.
//
// These back the unauthenticated /book/manage/[token] page a prospect reaches
// from the booking-confirmation email. Each function verifies the HMAC token
// (which carries the tenant), builds a SYSTEM action context for that tenant,
// and delegates to the existing action-layer booking operations. The tenant is
// taken from the SIGNED token, never the request (hard rule 9). The writes are
// deliberately NOT exposed as public MCP tools — the token is the authorization,
// so an attacker without the link can reach nothing (exsto-public-surface §1).
import { withActionContext, type ActionContext, type ActionResult } from '@exsto/substrate'
import { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import { rescheduleBooking, cancelBooking } from './calendarWorkspace.js'
import { getService } from './services.js'
import { getTenantSettings } from './tenantSettings.js'
import {
  verifyBookingManageToken,
  signBookingManageToken,
  type BookingManageTokenPayload,
} from './bookingManageToken.js'

export { signBookingManageToken }

// The public-intake SYSTEM actor in the firm's tenant (same actor the public
// booking submit and e-sign link flows run as). Client identity lives on the
// matter's client_contact, not this actor (ADR 0035).
const MANAGE_ACTOR = process.env.LEGAL_CLIENT_ACTOR_ID ?? '00000000-0000-0000-0001-000000000005'

function manageCtx(tenantId: string): ActionContext {
  return { tenantId, actorId: MANAGE_ACTOR }
}

export interface ManageableBooking {
  /** Client first name for a friendly greeting (never the full PII set). */
  clientFirstName: string | null
  matterNumber: string
  serviceKey: string | null
  serviceLabel: string | null
  scheduledAtIso: string | null
  scheduledEndIso: string | null
  /** Substrate matter_status, e.g. consultation_booked / consultation_cancelled. */
  status: string | null
  /** True when the appointment is still upcoming and not cancelled. */
  canModify: boolean
  // FB-C — the resolved firm's name off the SAME tenant the signed token
  // carries (never a hardcoded literal). Null when the firm hasn't set one.
  firmName: string | null
}

interface MatterRow {
  matter_number: string
  client_name: string | null
  service_key: string | null
  scheduled_at: string | null
  scheduled_end: string | null
  status: string | null
}

async function loadMatter(
  tok: BookingManageTokenPayload,
): Promise<{ ctx: ActionContext; row: MatterRow | null }> {
  const ctx = manageCtx(tok.tenantId)
  const row = await withActionContext(ctx, async (client) => {
    const res = await client.query<MatterRow>(
      `SELECT
         e.name AS matter_number,
         (SELECT a2.value #>> '{}'
            FROM relationship r
            JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
            JOIN attribute a2 ON a2.tenant_id = $1 AND a2.entity_id = r.source_entity_id
            JOIN attribute_kind_definition akd2 ON akd2.id = a2.attribute_kind_id AND akd2.kind_name = 'full_name'
            WHERE r.tenant_id = $1 AND r.target_entity_id = e.id AND rkd.kind_name = 'client_of'
            ORDER BY a2.valid_from DESC
            LIMIT 1) AS client_name,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'service_key' ORDER BY a.valid_from DESC LIMIT 1) AS service_key,
         e.metadata->>'scheduled_at' AS scheduled_at,
         e.metadata->>'scheduled_end' AS scheduled_end,
         (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id WHERE a.tenant_id = $1 AND a.entity_id = e.id AND akd.kind_name = 'matter_status' ORDER BY a.valid_from DESC LIMIT 1) AS status
       FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
       WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'matter' AND e.status = 'active'`,
      [tok.tenantId, tok.matterEntityId],
    )
    return res.rows[0] ?? null
  })
  return { ctx, row }
}

function firstNameOf(fullName: string | null): string | null {
  if (!fullName) return null
  const first = fullName.trim().split(/\s+/)[0]
  return first || null
}

function isUpcoming(scheduledAtIso: string | null, nowMs: number): boolean {
  if (!scheduledAtIso) return false
  const t = Date.parse(scheduledAtIso)
  return Number.isFinite(t) && t > nowMs
}

// Load the booking for the manage page. Throws on an invalid/expired token or a
// matter that no longer exists.
export async function loadManageableBooking(
  token: string,
  nowMs: number = Date.now(),
): Promise<ManageableBooking> {
  const tok = verifyBookingManageToken(token, nowMs)
  const { ctx, row } = await loadMatter(tok)
  if (!row) throw new Error('We could not find this appointment.')

  let serviceLabel: string | null = null
  if (row.service_key) {
    try {
      serviceLabel = (await getService(ctx, row.service_key))?.displayName ?? null
    } catch {
      serviceLabel = null // inactive/removed service — fall back to the raw key client-side
    }
  }

  let firmName: string | null = null
  try {
    firmName = (await getTenantSettings(ctx)).firmName
  } catch {
    firmName = null // degrade to the page's generic fallback, never guess a name
  }

  const cancelled = row.status === 'consultation_cancelled'
  return {
    clientFirstName: firstNameOf(row.client_name),
    matterNumber: row.matter_number,
    serviceKey: row.service_key,
    serviceLabel,
    scheduledAtIso: row.scheduled_at,
    scheduledEndIso: row.scheduled_end,
    status: row.status,
    canModify: !cancelled && isUpcoming(row.scheduled_at, nowMs),
    firmName,
  }
}

// Guard shared by both write paths: re-verify the token, re-load the matter, and
// refuse to act on a cancelled or already-past consultation (the email link is
// long-lived; the world may have moved on since it was sent).
async function loadModifiable(
  token: string,
  nowMs: number,
): Promise<{ ctx: ActionContext; tok: BookingManageTokenPayload }> {
  const tok = verifyBookingManageToken(token, nowMs)
  const { ctx, row } = await loadMatter(tok)
  if (!row) throw new Error('We could not find this appointment.')
  if (row.status === 'consultation_cancelled') {
    throw new Error('This consultation has already been cancelled.')
  }
  if (!isUpcoming(row.scheduled_at, nowMs)) {
    throw new Error('This consultation can no longer be changed online. Please contact the firm.')
  }
  return { ctx, tok }
}

export interface RescheduleByTokenInput {
  token: string
  startIso: string
  endIso: string
}

export async function rescheduleBookingByToken(
  input: RescheduleByTokenInput,
  nowMs: number = Date.now(),
): Promise<ActionResult> {
  if (!isUpcoming(input.startIso, nowMs)) {
    throw new Error('Please choose a time in the future.')
  }
  const { ctx, tok } = await loadModifiable(input.token, nowMs)
  // The system actor has no Google credentials; drive the calendar update with
  // the firm's primary connected actor while the substrate action records the
  // system actor as the initiator.
  const calendarActorId = (await resolveFirmPrimaryActor(tok.tenantId, 'google')) ?? undefined
  return rescheduleBooking(ctx, {
    matterEntityId: tok.matterEntityId,
    startIso: input.startIso,
    endIso: input.endIso,
    calendarActorId,
  })
}

export async function cancelBookingByToken(
  input: { token: string; reason?: string },
  nowMs: number = Date.now(),
): Promise<ActionResult> {
  const { ctx, tok } = await loadModifiable(input.token, nowMs)
  const calendarActorId = (await resolveFirmPrimaryActor(tok.tenantId, 'google')) ?? undefined
  return cancelBooking(ctx, {
    matterEntityId: tok.matterEntityId,
    reason: input.reason ?? 'Cancelled by client via appointment link.',
    calendarActorId,
  })
}
