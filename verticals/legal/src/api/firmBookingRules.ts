// ───────────────────────────────────────────────────────────────────────────
// Firm booking rules (Contract L) — the configurable constraints the public
// availability engine slices slots against: which days/hours are bookable, the
// buffer between calls, the minimum lead time, the slot granularity, and the
// default consultation length.
//
// Stored as config-as-data (hard rule 8): a SINGLETON workflow_definition row
// per tenant, kind_name `firm.booking_rules`, with the rules under its
// `transitions`. Writes flow through the `legal.booking_rules.update` action
// (handlers/bookingRules.ts), versioned + audited exactly like a service edit.
//
// Why workflow_definition and not the firm_settings entity (where Contract K's
// firm default rate lives): this worker ships independently of the in-flight
// Contract K work, and workflow_definition + configuration_change are already on
// main. firm.booking_rules is excluded from the service lists (listServices /
// listServicesIncludingInactive) so it never surfaces as a bookable service.
// Consolidating firm config onto firm_settings is a clean follow-up once that
// lands.
// ───────────────────────────────────────────────────────────────────────────
import { withActionContext, submitAction, type ActionContext } from '@exsto/substrate'

// 0 = Sunday … 6 = Saturday (JS getUTCDay convention).
export interface FirmBookingRules {
  // IANA timezone the bookable hours are expressed in.
  timezone: string
  // Weekdays open for booking, e.g. [1,2,3,4,5] for Mon–Fri.
  bookableDays: number[]
  // Wall-clock hours in `timezone`; `end` is exclusive (9–17 = 9am, last slot
  // ends by 5pm).
  bookableHours: { start: number; end: number }
  // Minutes between candidate slot start times (the booking grid step).
  slotGranularityMinutes: number
  // Padding enforced around existing busy blocks, so calls never butt up
  // against another meeting. 0 = back-to-back allowed.
  bufferMinutes: number
  // Earliest a client may book, as hours from now (notice). 0 = any future slot.
  minLeadTimeHours: number
  // Consultation length used when a service has no explicit duration_minutes.
  defaultDurationMinutes: number
}

// Defaults reproduce the prior hardcoded behavior (Mon–Fri, 9–5 ET, 30-min
// slots, no buffer, no lead time) so an unconfigured firm sees no change.
export const DEFAULT_FIRM_BOOKING_RULES: FirmBookingRules = {
  timezone: 'America/New_York',
  bookableDays: [1, 2, 3, 4, 5],
  bookableHours: { start: 9, end: 17 },
  slotGranularityMinutes: 30,
  bufferMinutes: 0,
  minLeadTimeHours: 0,
  defaultDurationMinutes: 30,
}

const FIRM_BOOKING_RULES_KIND = 'firm.booking_rules'

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? Math.round(v) : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

// Merge a stored (possibly partial / stale-shaped) value over the defaults and
// clamp every field to a safe range. A malformed stored blob still yields a
// well-formed, bookable ruleset — reads never throw.
export function normalizeFirmBookingRules(stored: unknown): FirmBookingRules {
  const s = (stored ?? {}) as Partial<FirmBookingRules> & {
    bookableHours?: { start?: unknown; end?: unknown }
  }
  const d = DEFAULT_FIRM_BOOKING_RULES

  const timezone =
    typeof s.timezone === 'string' && s.timezone.trim() ? s.timezone.trim() : d.timezone

  // Weekdays outside 0–6 are dropped (not clamped — a stray 9 must not silently
  // become Saturday). An all-invalid / empty list falls back to the default.
  const days = Array.isArray(s.bookableDays)
    ? Array.from(
        new Set(
          s.bookableDays
            .map((x) => (typeof x === 'number' ? Math.round(x) : Number(x)))
            .filter((x) => Number.isInteger(x) && x >= 0 && x <= 6),
        ),
      )
    : d.bookableDays
  const bookableDays = days.length ? days.sort((a, b) => a - b) : d.bookableDays

  let start = clampInt(s.bookableHours?.start, 0, 23, d.bookableHours.start)
  let end = clampInt(s.bookableHours?.end, 1, 24, d.bookableHours.end)
  if (end <= start) {
    start = d.bookableHours.start
    end = d.bookableHours.end
  }

  return {
    timezone,
    bookableDays,
    bookableHours: { start, end },
    slotGranularityMinutes: clampInt(s.slotGranularityMinutes, 5, 240, d.slotGranularityMinutes),
    bufferMinutes: clampInt(s.bufferMinutes, 0, 240, d.bufferMinutes),
    minLeadTimeHours: clampInt(s.minLeadTimeHours, 0, 720, d.minLeadTimeHours),
    defaultDurationMinutes: clampInt(s.defaultDurationMinutes, 5, 240, d.defaultDurationMinutes),
  }
}

// Read the active firm.booking_rules row's transitions, normalized. Defaults
// when the firm has never configured rules (no row yet).
export async function getFirmBookingRules(ctx: ActionContext): Promise<FirmBookingRules> {
  const stored = await withActionContext(ctx, async (client) => {
    const res = await client.query<{ transitions: unknown }>(
      `SELECT transitions
         FROM workflow_definition
        WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
        ORDER BY version DESC
        LIMIT 1`,
      [ctx.tenantId, FIRM_BOOKING_RULES_KIND],
    )
    return res.rows[0]?.transitions ?? null
  })
  return normalizeFirmBookingRules(stored)
}

// Patch + persist through the action layer. Returns the normalized result.
export async function updateFirmBookingRules(
  ctx: ActionContext,
  patch: Partial<FirmBookingRules>,
): Promise<FirmBookingRules> {
  const current = await getFirmBookingRules(ctx)
  const next = normalizeFirmBookingRules({ ...current, ...patch })
  await submitAction(ctx, {
    actionKindName: 'legal.booking_rules.update',
    intentKind: 'adjustment',
    payload: { rules: next },
  })
  return next
}
