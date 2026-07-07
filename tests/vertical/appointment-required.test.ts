// PR2 — per-service "appointment required" toggle. Pure unit contracts (no DB):
// the read-side default (absent ⇒ true, so no existing service changes behavior
// until an attorney unchecks the box), the derived-lifecycle coherence (an
// intake-only service's fallback graph drops the consultation stages), and the
// intake-confirmation email's honest no-consultation copy.
import { describe, it, expect } from 'vitest'
import {
  parseAppointmentRequired,
  deriveLifecycleFromService,
  renderNotificationTemplate,
  updateServiceMetadata,
} from '@exsto/legal'

describe('parseAppointmentRequired — only explicit false turns the appointment off', () => {
  it('defaults absent/undefined to true (every pre-existing service)', () => {
    expect(parseAppointmentRequired(undefined)).toBe(true)
  })
  it('keeps explicit true', () => {
    expect(parseAppointmentRequired(true)).toBe(true)
  })
  it('treats garbage as true (never silently intake-only)', () => {
    expect(parseAppointmentRequired('false')).toBe(true)
    expect(parseAppointmentRequired(0)).toBe(true)
    expect(parseAppointmentRequired(null)).toBe(true)
  })
  it('honors explicit false', () => {
    expect(parseAppointmentRequired(false)).toBe(false)
  })
})

describe('updateServiceMetadata — write side accepts ONLY booleans', () => {
  // The untyped MCP tool passes input verbatim; garbage ("true", 1, null) must
  // throw BEFORE any substrate write, never coerce into a stored false that
  // silently flips a live service to intake-only. The throw happens ahead of
  // the DB call, so this runs without a database.
  it.each([['true'], [1], [null]])('rejects non-boolean %j', async (bad) => {
    await expect(
      updateServiceMetadata(
        { tenantId: 't', actorId: 'a' },
        {
          serviceKey: 'svc',
          displayName: 'Svc',
          appointmentRequired: bad as never,
        },
      ),
    ).rejects.toThrow(/boolean/)
  })
})

describe('derived lifecycle — intake-only services have no consultation stages', () => {
  it('drops consultation_booked when bookingEnabled is false', () => {
    const lc = deriveLifecycleFromService({ route: 'manual', bookingEnabled: false })
    expect(lc.some((s) => s.key === 'consultation_booked')).toBe(false)
  })
  it('keeps consultation_booked when bookingEnabled is true', () => {
    const lc = deriveLifecycleFromService({ route: 'manual', bookingEnabled: true })
    expect(lc.some((s) => s.key === 'consultation_booked')).toBe(true)
  })
})

describe('prospect-intake-confirmation — branches on consultation presence', () => {
  it('references the consultation when a slot exists', () => {
    const out = renderNotificationTemplate('prospect-intake-confirmation', {
      client_first_name: 'Ada',
      scheduled_at: '2026-07-10T15:00:00Z',
    })
    expect(out.bodyText).toContain('before your consultation')
  })
  it('never mentions a consultation on the intake-only path', () => {
    const out = renderNotificationTemplate('prospect-intake-confirmation', {
      client_first_name: 'Ada',
    })
    expect(out.bodyText).not.toContain('consultation')
    expect(out.bodyText).toContain('follow up with next steps by email')
  })
})
