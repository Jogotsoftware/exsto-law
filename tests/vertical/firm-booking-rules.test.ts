// Firm booking rules (Contract L) drive the availability engine. These are pure
// checks — no DB, no Google — over getStubAvailability (the same candidate-slot
// generator the real Google path overlays busy times onto), so they prove the
// offered slots respect the configured duration, bookable days, bookable hours,
// lead time, and granularity. Buffer is applied only against real busy blocks
// (getGoogleAvailability), so it isn't exercised here.
import { describe, it, expect } from 'vitest'
import {
  getStubAvailability,
  normalizeFirmBookingRules,
  DEFAULT_FIRM_BOOKING_RULES,
  type FirmBookingRules,
} from '@exsto/legal'

// UTC keeps the weekday/hour assertions simple (getUTCDay / getUTCHours).
const baseRules: FirmBookingRules = {
  timezone: 'UTC',
  bookableDays: [1, 3], // Mon, Wed
  bookableHours: { start: 9, end: 12 },
  slotGranularityMinutes: 30,
  bufferMinutes: 0,
  minLeadTimeHours: 0,
  defaultDurationMinutes: 30,
}

describe('availability engine respects firm booking rules', () => {
  const slots = getStubAvailability(60, baseRules, 45)

  it('produces some slots', () => {
    expect(slots.length).toBeGreaterThan(0)
  })

  it('sizes every slot to the requested service duration (45 min)', () => {
    for (const s of slots) {
      const mins = (new Date(s.endIso).getTime() - new Date(s.startIso).getTime()) / 60000
      expect(mins).toBe(45)
    }
  })

  it('only offers slots on the configured bookable days (Mon, Wed)', () => {
    for (const s of slots) {
      expect(baseRules.bookableDays).toContain(new Date(s.startIso).getUTCDay())
    }
  })

  it('keeps every slot inside the bookable hours window (start 9:00, end by 12:00)', () => {
    for (const s of slots) {
      const start = new Date(s.startIso)
      const end = new Date(s.endIso)
      expect(start.getUTCHours()).toBeGreaterThanOrEqual(9)
      const endMinuteOfDay = end.getUTCHours() * 60 + end.getUTCMinutes()
      expect(endMinuteOfDay).toBeLessThanOrEqual(12 * 60)
    }
  })

  it('steps slot starts by the configured granularity within a day', () => {
    const byDay = new Map<string, number[]>()
    for (const s of slots) {
      const d = new Date(s.startIso)
      const key = d.toISOString().slice(0, 10)
      const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes()
      byDay.set(key, [...(byDay.get(key) ?? []), minuteOfDay])
    }
    for (const mins of byDay.values()) {
      const sorted = [...mins].sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i]! - sorted[i - 1]!).toBe(baseRules.slotGranularityMinutes)
      }
    }
  })

  it('respects the minimum lead time (no slot earlier than now + lead time)', () => {
    const leadHours = 72
    const earliest = Date.now() + leadHours * 3600_000
    const leadSlots = getStubAvailability(60, { ...baseRules, minLeadTimeHours: leadHours }, 30)
    expect(leadSlots.length).toBeGreaterThan(0)
    for (const s of leadSlots) {
      expect(new Date(s.startIso).getTime()).toBeGreaterThan(earliest)
    }
  })
})

describe('normalizeFirmBookingRules', () => {
  it('returns the defaults for an empty/absent value', () => {
    expect(normalizeFirmBookingRules(null)).toEqual(DEFAULT_FIRM_BOOKING_RULES)
    expect(normalizeFirmBookingRules({})).toEqual(DEFAULT_FIRM_BOOKING_RULES)
  })

  it('clamps out-of-range numbers and drops invalid weekdays', () => {
    const r = normalizeFirmBookingRules({
      bookableDays: [1, 9, -2, 5, 5], // 9 and -2 invalid; 5 de-duped
      bufferMinutes: -10, // floored to 0
      minLeadTimeHours: 99999, // clamped to 720
      slotGranularityMinutes: 1, // clamped up to 5
      defaultDurationMinutes: 30,
    })
    expect(r.bookableDays).toEqual([1, 5])
    expect(r.bufferMinutes).toBe(0)
    expect(r.minLeadTimeHours).toBe(720)
    expect(r.slotGranularityMinutes).toBe(5)
  })

  it('falls back to default hours when end is not after start', () => {
    const r = normalizeFirmBookingRules({ bookableHours: { start: 18, end: 9 } })
    expect(r.bookableHours).toEqual(DEFAULT_FIRM_BOOKING_RULES.bookableHours)
  })

  it('keeps a valid custom timezone', () => {
    expect(normalizeFirmBookingRules({ timezone: 'America/Chicago' }).timezone).toBe(
      'America/Chicago',
    )
  })
})
