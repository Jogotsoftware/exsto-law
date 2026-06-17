// Unified calendar feed (real-calendar PR): the dashboard merges app-booked
// consultations with the attorney's real Google events. mergeCalendarFeed is the
// pure dedup/merge core — a matter-linked ("managedByApp") Google event IS the
// consultation, so it must NOT be double-counted; events without a start are
// dropped; the result is time-sorted. Pure (no DB / no Google).
import { describe, it, expect } from 'vitest'

const consultation = {
  matterEntityId: 'm1',
  matterNumber: 'M-1',
  clientName: 'Acme LLC',
  serviceKey: 'llc_formation',
  scheduledAt: '2026-06-20T15:00:00.000Z',
  scheduledEnd: '2026-06-20T15:30:00.000Z',
  status: 'consultation_scheduled',
  bookedAt: '2026-06-15T00:00:00.000Z',
  category: 'new_consultation' as const,
}

function gEvent(over: Record<string, unknown>) {
  return {
    eventId: 'g',
    summary: 'Event',
    startIso: '2026-06-19T09:00:00.000Z',
    endIso: '2026-06-19T10:00:00.000Z',
    allDay: false,
    htmlLink: 'https://calendar.google.com/x',
    attendeeEmails: [],
    status: 'confirmed',
    matterEntityId: null,
    matterNumber: null,
    managedByApp: false,
    ...over,
  }
}

describe('mergeCalendarFeed (pure)', { timeout: 90_000 }, () => {
  it('merges consultations + external Google events, dedups managed ones, drops no-start, sorts by time', async () => {
    const { mergeCalendarFeed } = await import('@exsto/legal')
    const feed = mergeCalendarFeed(
      [consultation] as never,
      [
        gEvent({ eventId: 'g1', summary: 'Dentist', startIso: '2026-06-19T09:00:00.000Z' }), // external
        gEvent({
          eventId: 'g2',
          summary: 'Acme consult',
          startIso: '2026-06-20T15:00:00.000Z',
          matterEntityId: 'm1',
          managedByApp: true,
        }), // managed → IS the consultation, must dedup
        gEvent({ eventId: 'g3', summary: 'No time', startIso: null, endIso: null }), // dropped
      ] as never,
    )

    expect(feed).toHaveLength(2) // 1 consultation + 1 external (g1)
    expect(feed[0]!.id).toBe('gcal:g1') // 06-19 sorts before 06-20
    expect(feed[0]!.kind).toBe('external')
    expect(feed[0]!.htmlLink).toContain('calendar.google.com')
    expect(feed[1]!.kind).toBe('consultation')
    expect(feed[1]!.matterEntityId).toBe('m1')
    expect(feed[1]!.category).toBe('new_consultation')
    expect(feed.find((f) => f.id === 'gcal:g2')).toBeUndefined() // managed → deduped
    expect(feed.find((f) => f.id === 'gcal:g3')).toBeUndefined() // no start → dropped
  })

  it('returns only consultations when Google has no events (disconnected)', async () => {
    const { mergeCalendarFeed } = await import('@exsto/legal')
    const feed = mergeCalendarFeed([consultation] as never, [])
    expect(feed).toHaveLength(1)
    expect(feed[0]!.kind).toBe('consultation')
  })
})
