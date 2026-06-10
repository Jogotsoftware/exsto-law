import { google, type calendar_v3 } from 'googleapis'
import { withSuperuser, type DbClient } from '@exsto/shared'

// ───────────────────────────────────────────────────────────────────────────
// OAuth + token storage
// ───────────────────────────────────────────────────────────────────────────

export interface GoogleOAuthCredentials {
  accountEmail: string
  accessToken: string
  refreshToken: string
  expiresAt: Date
  scope: string
  calendarId: string
}

export function getOAuthClientConfig(): {
  clientId: string
  clientSecret: string
  redirectUri: string
} | null {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri }
}

export const GOOGLE_OAUTH_SCOPES_SIGNIN = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

export const GOOGLE_OAUTH_SCOPES_CALENDAR = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
]

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'

// Backwards compat for any existing imports.
export const GOOGLE_OAUTH_SCOPES = GOOGLE_OAUTH_SCOPES_CALENDAR

// Loose return type; the actual type lives in google-auth-library, which we
// don't want as a direct workspace dep — googleapis re-exports the runtime.
export function buildOAuthClient(
  redirectOverride?: string,
): InstanceType<typeof google.auth.OAuth2> {
  const cfg = getOAuthClientConfig()
  if (!cfg) {
    throw new Error(
      'Google OAuth not configured. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI in env.',
    )
  }
  return new google.auth.OAuth2(cfg.clientId, cfg.clientSecret, redirectOverride ?? cfg.redirectUri)
}

export async function loadCredentials(tenantId: string): Promise<GoogleOAuthCredentials | null> {
  return withSuperuser(async (client) => loadCredentialsWith(client, tenantId))
}

async function loadCredentialsWith(
  client: DbClient,
  tenantId: string,
): Promise<GoogleOAuthCredentials | null> {
  const res = await client.query<{
    account_email: string
    access_token: string
    refresh_token: string
    expires_at: Date
    scope: string
    calendar_id: string
  }>(
    `SELECT account_email, access_token, refresh_token, expires_at, scope, calendar_id
     FROM google_oauth WHERE tenant_id = $1`,
    [tenantId],
  )
  const row = res.rows[0]
  if (!row) return null
  return {
    accountEmail: row.account_email,
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: new Date(row.expires_at),
    scope: row.scope,
    calendarId: row.calendar_id,
  }
}

export async function saveCredentials(
  tenantId: string,
  creds: GoogleOAuthCredentials,
): Promise<void> {
  await withSuperuser(async (client) => {
    await client.query(
      `INSERT INTO google_oauth (tenant_id, account_email, access_token, refresh_token, expires_at, scope, calendar_id, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       ON CONFLICT (tenant_id) DO UPDATE
       SET account_email = EXCLUDED.account_email,
           access_token = EXCLUDED.access_token,
           refresh_token = EXCLUDED.refresh_token,
           expires_at = EXCLUDED.expires_at,
           scope = EXCLUDED.scope,
           calendar_id = EXCLUDED.calendar_id,
           updated_at = now()`,
      [
        tenantId,
        creds.accountEmail,
        creds.accessToken,
        creds.refreshToken,
        creds.expiresAt,
        creds.scope,
        creds.calendarId,
      ],
    )
  })
}

export async function deleteCredentials(tenantId: string): Promise<void> {
  await withSuperuser(async (client) => {
    await client.query(`DELETE FROM google_oauth WHERE tenant_id = $1`, [tenantId])
  })
}

async function authedClient(tenantId: string) {
  const creds = await loadCredentials(tenantId)
  if (!creds) throw new Error('Google Calendar not connected for this tenant.')
  const oauth2 = buildOAuthClient()
  oauth2.setCredentials({
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expiry_date: creds.expiresAt.getTime(),
    scope: creds.scope,
  })
  // Persist refreshed tokens automatically.
  oauth2.on('tokens', (tokens) => {
    void (async () => {
      try {
        const refreshed: GoogleOAuthCredentials = {
          ...creds,
          accessToken: tokens.access_token ?? creds.accessToken,
          refreshToken: tokens.refresh_token ?? creds.refreshToken,
          expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : creds.expiresAt,
          scope: tokens.scope ?? creds.scope,
        }
        await saveCredentials(tenantId, refreshed)
      } catch {
        // best-effort; don't break the calling request
      }
    })()
  })
  return { oauth2, creds }
}

// ───────────────────────────────────────────────────────────────────────────
// Availability + bookings (real Google Calendar)
// ───────────────────────────────────────────────────────────────────────────

export interface AvailabilitySlot {
  startIso: string
  endIso: string
  label: string
  // true if the slot is bookable. When Google Calendar is connected for the
  // tenant, busy blocks (existing events) flip this to false instead of
  // dropping the slot, so the client can render taken times as disabled.
  available: boolean
}

// Attorney working timezone. TODO: lift to tenant config (currently Pacheco
// Law only; everything is NY time).
const ATTORNEY_TZ = 'America/New_York'

// Build a UTC instant for a given calendar date + wall-clock hour in a
// specific timezone. Uses Intl.DateTimeFormat to figure out the offset for
// that local moment, then constructs the ISO instant.
function isoFromZonedWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  // First pass: build an instant assuming UTC, then ask Intl what wall-clock
  // time that instant looks like in the target timezone, and correct by the
  // difference. One iteration handles DST correctly because the offset for
  // the target wall time is stable within +/- 1 hour.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0)
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(fmt.formatToParts(new Date(asUtc)).map((p) => [p.type, p.value]))
  const seen = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour === '24' ? '0' : parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  const correction = asUtc - seen
  return new Date(asUtc + correction).toISOString()
}

// Working hours for the attorney (Mon–Fri, attorney TZ). TODO: lift to
// tenant config when we onboard the second firm.
const WORKING_HOUR_START = 9
const WORKING_HOUR_END = 17
const SLOT_MINUTES = 30

// Build the candidate slot template: 30-min slots through working hours,
// Mon–Fri in attorney TZ, starting from now (skipping past times so same-day
// bookings only show times still in the future).
function generateCandidateSlots(daysOut: number): AvailabilitySlot[] {
  const slots: AvailabilitySlot[] = []
  const now = new Date()
  const nowMs = now.getTime()
  const todayParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ATTORNEY_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number)

  for (let dayOffset = 0; dayOffset <= daysOut; dayOffset += 1) {
    const date = new Date(Date.UTC(todayParts[0]!, todayParts[1]! - 1, todayParts[2]! + dayOffset))
    const dow = date.getUTCDay()
    if (dow === 0 || dow === 6) continue // Sun, Sat
    const y = date.getUTCFullYear()
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()

    for (let hour = WORKING_HOUR_START; hour < WORKING_HOUR_END; hour += 1) {
      for (const startMinute of [0, 30]) {
        const startIso = isoFromZonedWallTime(y, m, d, hour, startMinute, ATTORNEY_TZ)
        const endMinute = startMinute === 0 ? SLOT_MINUTES : 0
        const endHour = startMinute === 0 ? hour : hour + 1
        const endIso = isoFromZonedWallTime(y, m, d, endHour, endMinute, ATTORNEY_TZ)
        if (new Date(startIso).getTime() <= nowMs) continue
        slots.push({
          startIso,
          endIso,
          available: true,
          label: new Date(startIso).toLocaleString('en-US', {
            timeZone: ATTORNEY_TZ,
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          }),
        })
      }
    }
  }
  return slots
}

// Returns the working-hour template with every slot marked available. Used as
// a fallback when Google isn't connected or the freebusy call fails.
export function getStubAvailability(daysOut = 7): AvailabilitySlot[] {
  return generateCandidateSlots(daysOut)
}

export async function getGoogleAvailability(
  tenantId: string,
  daysOut = 14,
): Promise<AvailabilitySlot[]> {
  const { oauth2, creds } = await authedClient(tenantId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  const now = new Date()
  // Pad the horizon by 1 day so freebusy covers the last slot's end time.
  const end = new Date(now.getTime() + (daysOut + 1) * 24 * 3600 * 1000)
  const busyRes = await calendar.freebusy.query({
    requestBody: {
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      items: [{ id: creds.calendarId }],
    },
  })
  const busy = (busyRes.data.calendars?.[creds.calendarId]?.busy ?? []).map((b) => ({
    start: new Date(b.start!).getTime(),
    end: new Date(b.end!).getTime(),
  }))

  const candidates = generateCandidateSlots(daysOut)
  return candidates.map((slot) => {
    const s = new Date(slot.startIso).getTime()
    const e = new Date(slot.endIso).getTime()
    const conflict = busy.some((b) => s < b.end && e > b.start)
    return { ...slot, available: !conflict }
  })
}

// Tries Google first; falls back to stub if anything goes wrong. Logs the
// actual error so we can diagnose silent fallbacks without the UI hiding the
// problem.
export async function getAvailability(
  tenantId: string,
  daysOut = 14,
): Promise<{ slots: AvailabilitySlot[]; source: 'google' | 'stub'; reason?: string }> {
  try {
    const slots = await getGoogleAvailability(tenantId, daysOut)
    return { slots, source: 'google' }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.error(
      `[getAvailability] Google availability failed for tenant ${tenantId}; falling back to stub. Reason: ${reason}`,
    )
    return { slots: getStubAvailability(daysOut), source: 'stub', reason }
  }
}

export interface CreateEventInput {
  tenantId: string
  summary: string
  descriptionHtml: string
  startIso: string
  endIso: string
  attorneyEmail: string
  clientEmail: string
  clientName: string
  matterId: string
  matterReschedulePath: string // e.g. /book/reschedule/<matter_id>
  bookingBaseUrl: string // e.g. https://exstolaw.netlify.app
}

export interface CreatedEvent {
  eventId: string
  htmlLink: string
  iCalUid: string | null | undefined
}

export async function createBookingEvent(input: CreateEventInput): Promise<CreatedEvent> {
  const { oauth2, creds } = await authedClient(input.tenantId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })

  const rescheduleUrl = `${input.bookingBaseUrl}${input.matterReschedulePath}`
  const cancelUrl = `${input.bookingBaseUrl}/book/cancel/${input.matterId}`

  // Google Calendar event descriptions support a limited HTML subset:
  // <a>, <b>, <i>, <u>, <br>, <p>, <ul>, <ol>, <li>, <hr>. Use those only.
  const description = `
${input.descriptionHtml}
<br><br>
<b>Reschedule or cancel:</b><br>
<a href="${rescheduleUrl}">Reschedule this consultation</a><br>
<a href="${cancelUrl}">Cancel</a>
<br><br>
<i>Booked through Pacheco Law &middot; <a href="${input.bookingBaseUrl}/book">Book another consultation</a></i>
  `.trim()

  const event: calendar_v3.Schema$Event = {
    summary: input.summary,
    description,
    start: { dateTime: input.startIso },
    end: { dateTime: input.endIso },
    attendees: [
      { email: input.attorneyEmail, responseStatus: 'accepted', organizer: true },
      { email: input.clientEmail, displayName: input.clientName },
    ],
    reminders: { useDefault: true },
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    guestsCanSeeOtherGuests: false,
    visibility: 'private',
  }

  const res = await calendar.events.insert({
    calendarId: creds.calendarId,
    requestBody: event,
    sendUpdates: 'all', // triggers Google's invite emails to all attendees
  })

  return {
    eventId: res.data.id!,
    htmlLink: res.data.htmlLink ?? '',
    iCalUid: res.data.iCalUID,
  }
}

export async function rescheduleEvent(
  tenantId: string,
  eventId: string,
  newStartIso: string,
  newEndIso: string,
): Promise<void> {
  const { oauth2, creds } = await authedClient(tenantId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  await calendar.events.patch({
    calendarId: creds.calendarId,
    eventId,
    sendUpdates: 'all',
    requestBody: {
      start: { dateTime: newStartIso },
      end: { dateTime: newEndIso },
    },
  })
}

export async function cancelEvent(tenantId: string, eventId: string): Promise<void> {
  const { oauth2, creds } = await authedClient(tenantId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  await calendar.events.delete({
    calendarId: creds.calendarId,
    eventId,
    sendUpdates: 'all',
  })
}
