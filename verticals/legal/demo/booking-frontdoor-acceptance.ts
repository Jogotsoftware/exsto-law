// BOOKING-FRONTDOOR-1 acceptance B/D/E/G. Sandbox tenant for WRITES (D/E/G); a
// READ-ONLY free/busy probe against tenant-zero (Pacheco, the only firm with Google
// connected) for B — no writes to tenant-zero. Prints a JSON receipt.
import '@exsto/legal'
import {
  getPublicAvailability,
  updateFirmBookingRules,
  getFirmBookingRules,
  getBusyIntervals,
  resolveFirmPrimaryActor,
} from '@exsto/legal'
import { submitAction, type ActionContext } from '@exsto/substrate'

const SANDBOX = '00000000-0000-0000-00fe-000000000001'
const TENANT_ZERO = '00000000-0000-0000-0000-000000000001'
// Sandbox's own system actor stands in for the public-intake actor (the seeded
// public-intake actor …0001-…0005 exists in Pacheco's tenant; sandbox uses its own).
const SANDBOX_SYS = '00000000-0000-0000-00fe-000000000002'

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required.')
  const receipt: Record<string, unknown> = {}

  // ── E: no Google connection → honest NONE (never fabricated) ──────────────────
  const eAvail = await getPublicAvailability('exsto-sandbox')
  receipt.E_noGoogle = {
    firmName: eAvail?.firmName,
    configured: eAvail?.configured,
    slotCount: eAvail?.slots.length,
  }

  // ── G: attorney edits booking rules through core (legal.booking_rules.update) ─
  const sbCtx: ActionContext = { tenantId: SANDBOX, actorId: SANDBOX_SYS }
  const saved = await updateFirmBookingRules(sbCtx, {
    bookableDays: [2, 4],
    bookableHours: { start: 13, end: 17 },
    slotGranularityMinutes: 30,
    bufferMinutes: 15,
    meetingLengthsMinutes: [15, 30, 45],
  })
  const reread = await getFirmBookingRules(sbCtx)
  receipt.G_settings = {
    savedHours: saved.bookableHours,
    savedDays: saved.bookableDays,
    savedLengths: saved.meetingLengthsMinutes,
    savedBuffer: saved.bufferMinutes,
    rereadLengths: reread.meetingLengthsMinutes,
    rereadHours: reread.bookableHours,
  }

  // ── D: a booking through the public path — the substrate writes (contact +
  //    booking.create) attributed to the public-intake (system) actor, CONTACT as
  //    the booking subject. (Sandbox has no Google, so the calendar-event write is
  //    exercised separately/by reuse — here we prove the substrate half.) ─────────
  const created = await submitAction(sbCtx, {
    actionKindName: 'legal.client.create',
    intentKind: 'enforcement',
    payload: {
      client_name: 'FrontDoor Test Prospect',
      metadata: {
        source: 'public_booking',
        booking_slug: 'exsto-sandbox',
        contact_email: 'prospect@example.com',
        contact_phone: '+15551234567',
        booking_reason: 'Discuss a mutual NDA',
      },
    },
  })
  const clientEntityId = (created.effects[0] as { clientEntityId: string }).clientEntityId
  const start = new Date(Date.now() + 3 * 86_400_000)
  start.setUTCHours(18, 0, 0, 0)
  const end = new Date(start.getTime() + 30 * 60_000)
  const booked = await submitAction(sbCtx, {
    actionKindName: 'booking.create',
    intentKind: 'enforcement',
    payload: {
      matter_entity_id: clientEntityId,
      matter_number: 'B-FD-TEST',
      scheduled_at: start.toISOString(),
      scheduled_end: end.toISOString(),
      google_event_id: null,
      google_event_url: null,
    },
  })
  receipt.D_booking = {
    clientEntityId,
    clientCreateActionId: created.actionId,
    bookingCreateActionId: booked.actionId,
    actor: SANDBOX_SYS,
    scheduledAt: start.toISOString(),
  }

  // ── B: LIVE free/busy read against a connected tenant (tenant-zero, READ-ONLY) ─
  const firmActor = await resolveFirmPrimaryActor(TENANT_ZERO, 'google')
  const from = new Date()
  const to = new Date(from.getTime() + 14 * 86_400_000)
  const busy = await getBusyIntervals(
    { tenantId: TENANT_ZERO, actorId: firmActor ?? '' },
    { fromIso: from.toISOString(), toIso: to.toISOString() },
  )
  receipt.B_liveBusyRead = {
    firmActor,
    source: busy.source,
    busyIntervalCount: busy.intervals.length,
    firstBusy: busy.intervals[0] ?? null,
  }

  console.log('\n===BOOKING_FRONTDOOR_RECEIPT===')
  console.log(JSON.stringify(receipt, null, 2))
  console.log('===END===')
}

main().catch((e) => {
  console.error('RUN FAILED:', e instanceof Error ? e.stack : String(e))
  process.exit(1)
})
