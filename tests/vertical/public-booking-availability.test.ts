// BOOKING-FRONTDOOR-1 acceptance C/F (pure, no DB/Google) — the availability
// INTERSECTION: rules-generated candidate slots with the firm's busy blocks
// subtracted (buffer-expanded). A busy interval removes its slot AND slots within the
// buffer; free slots stay. This is the "rules ∩ live-busy" computation the public
// booker relies on; the LIVE free/busy read is proven separately against a connected
// tenant. Dates are relative to "now", so the test marks a GENERATED candidate busy
// (not a hand-picked wall-clock time) and asserts it drops out.
import { describe, it, expect } from 'vitest'
import {
  computeAvailabilityFromBusy,
  DEFAULT_FIRM_BOOKING_RULES,
  type FirmBookingRules,
} from '@exsto/legal'

// All weekdays bookable so candidates exist regardless of what day the test runs.
const RULES: FirmBookingRules = {
  ...DEFAULT_FIRM_BOOKING_RULES,
  bookableDays: [0, 1, 2, 3, 4, 5, 6],
  bookableHours: { start: 9, end: 17 },
  slotGranularityMinutes: 30,
  bufferMinutes: 15,
  minLeadTimeHours: 0,
  defaultDurationMinutes: 30,
  meetingLengthsMinutes: [30],
}

const ms = (iso: string): number => new Date(iso).getTime()

describe('public booking availability — rules ∩ busy (acceptance C/F)', () => {
  it('with NO busy, every rules-candidate slot is available', () => {
    const slots = computeAvailabilityFromBusy(3, RULES, 30, [])
    expect(slots.length).toBeGreaterThan(5)
    expect(slots.every((s) => s.available)).toBe(true)
  })

  it('a busy interval EXCLUDES its own slot (a booked time is removed)', () => {
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const target = free[4]! // some mid-list candidate
    const busy = [{ start: ms(target.startIso), end: ms(target.endIso) }]
    const withBusy = computeAvailabilityFromBusy(3, RULES, 30, busy)
    const after = withBusy.find((s) => s.startIso === target.startIso)!
    expect(after.available).toBe(false)
  })

  it('a free slot well before the busy block stays available', () => {
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const target = free[4]!
    const busy = [{ start: ms(target.startIso), end: ms(target.endIso) }]
    const withBusy = computeAvailabilityFromBusy(3, RULES, 30, busy)
    // free[0] is > 4 slots (>2h) earlier — outside the 15-min buffer — so still open.
    const early = withBusy.find((s) => s.startIso === free[0]!.startIso)!
    expect(early.available).toBe(true)
  })

  it('the 15-min buffer also removes the slot immediately adjacent to the busy block', () => {
    // The brief scenario: a 14:00–14:30 busy with a 15-min buffer removes 14:00 AND
    // the abutting slots within the buffer (stricter than the busy block alone).
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const target = free[4]!
    const prev = free[3]! // ends exactly at target.start → inside the buffer
    const busy = [{ start: ms(target.startIso), end: ms(target.endIso) }]
    const withBusy = computeAvailabilityFromBusy(3, RULES, 30, busy)
    expect(withBusy.find((s) => s.startIso === prev.startIso)!.available).toBe(false)
  })
})
