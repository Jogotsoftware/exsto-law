// CLIENT-PORTAL-UI-1 CORRECTIVE (WP-C3.3) — the REAL post-acceptance
// client-initiated booking: live Google availability, calendar hold, and a
// booking.create attributed to the founder's own portal actor. Runs the same
// scheduleClientTime the portal tool calls (engagement gate included).
import '@exsto/legal'
import { getPortalSchedulingAvailability, scheduleClientTime } from '@exsto/legal'
import { withActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ctx = { tenantId: TENANT, actorId: '0e6ac4c2-8669-4c5f-9e9e-871705bddeae' } // Joseph A Pacheco portal actor

const count = async () =>
  withActionContext(
    { tenantId: TENANT, actorId: '00000000-0000-0000-0001-000000000002' },
    async (c) => {
      const r = await c.query(
        `SELECT count(*) AS n FROM action a
         JOIN action_kind_definition k ON k.id=a.action_kind_id
         WHERE a.tenant_id=$1 AND k.kind_name='booking.create'`,
        [TENANT],
      )
      return Number(r.rows[0].n)
    },
  )

const before = await count()
const avail = await getPortalSchedulingAvailability(ctx, { daysOut: 21 })
console.log(`availability configured=${avail.configured} slots=${avail.slots.length}`)
if (!avail.configured || avail.slots.length === 0) {
  console.log('SKIP — Google adapter unreachable')
  process.exit(2)
}
const slot = avail.slots[avail.slots.length - 1]
const r = await scheduleClientTime(ctx, {
  clientContactId: 'fd690e57-dc76-4a0f-9605-a26be095b1f4',
  startIso: slot.startIso,
  endIso: slot.endIso,
  reason: 'Corrective WP-C3 post-acceptance booking test',
})
const after = await count()
console.log(
  `booking.create ${before}→${after} ref=${r.bookingRef} start=${r.startIso} calendarWritten=${r.calendarWritten}`,
)
process.exit(0)
