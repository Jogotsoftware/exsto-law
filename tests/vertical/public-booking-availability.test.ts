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

  // Robust across day boundaries: offsets are relative to ONE picked slot's own
  // wall-clock time (never an assumption about which two candidates are adjacent).
  it('a busy interval EXCLUDES its own slot AND slots within the buffer', () => {
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const s = free[4]!
    const sStart = ms(s.startIso)

    // (a) busy exactly over the slot → the slot is removed (a booked time).
    const withOwn = computeAvailabilityFromBusy(3, RULES, 30, [
      { start: sStart, end: ms(s.endIso) },
    ])
    expect(withOwn.find((x) => x.startIso === s.startIso)!.available).toBe(false)

    // (b) a 1-minute busy ending 9 minutes before the slot starts is WITHIN the
    //     15-min buffer → the slot is still removed (the required gap between calls).
    const withBuffer = computeAvailabilityFromBusy(3, RULES, 30, [
      { start: sStart - 10 * 60_000, end: sStart - 9 * 60_000 },
    ])
    expect(withBuffer.find((x) => x.startIso === s.startIso)!.available).toBe(false)
  })

  it('a slot far from any busy block stays available (busy over ONE slot leaves the rest open)', () => {
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const target = free[4]!
    const withBusy = computeAvailabilityFromBusy(3, RULES, 30, [
      { start: ms(target.startIso), end: ms(target.endIso) },
    ])
    // The earliest slot is many slots / a day away from free[4] — well outside the
    // buffer — so it stays open. (Only free[4] and its buffer neighbours drop.)
    const early = withBusy.find((x) => x.startIso === free[0]!.startIso)!
    expect(early.available).toBe(true)
    // And the vast majority of slots remain available (a single busy block).
    expect(withBusy.filter((x) => x.available).length).toBeGreaterThan(free.length - 5)
  })

  // BOOKING-CALENDAR-VIEW-1 acceptance B (privacy, at the data layer): a BLOCKED cell
  // is anonymous. The busy input is `{start, end}` only — the freebusy read carries no
  // event titles — so a blocked slot's label is the SAME time-only label it had when
  // free; the "busy" state adds available:false and nothing else. No event detail can
  // reach the public calendar because none exists anywhere in this path.
  it('a blocked slot is anonymous — same time-only label as when free, no event detail', () => {
    const free = computeAvailabilityFromBusy(3, RULES, 30, [])
    const s = free[4]!
    const withBusy = computeAvailabilityFromBusy(3, RULES, 30, [
      { start: ms(s.startIso), end: ms(s.endIso) },
    ])
    const blocked = withBusy.find((x) => x.startIso === s.startIso)!
    expect(blocked.available).toBe(false)
    expect(blocked.label).toBe(s.label) // identical to the free label — time only
    // The label is a date/time string, never an event title / client name.
    expect(blocked.label).toMatch(/\d/)
  })
})
