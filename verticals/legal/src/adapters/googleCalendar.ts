import { google, type calendar_v3 } from 'googleapis'
import {
  saveConnection,
  loadConnection,
  disconnect,
  markConnectionError,
} from './connectionStore.js'
import { redactSecret } from './redact.js'

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

// Identity-only sign-in (no credential storage): just enough to resolve the
// Google email → attorney actor.
export const GOOGLE_OAUTH_SCOPES_SIGNIN = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
]

// ONE Google connection grants everything the app uses: calendar read/write,
// Gmail read, and Gmail send. We deliberately retired the old staged consent
// (calendar first, "Enable Mail" later for gmail.readonly): the single
// "Connect Google" in Settings asks for the full set in one consent, so an
// attorney connects once and has calendar + full email. (Supersedes the
// incremental REQ-CALMAIL-03/REQ-AUTH-03 staging.)
export const GOOGLE_OAUTH_SCOPES_CONNECT = [
  // Calendar: full read/write. `calendar.events` is kept (existing scope-presence
  // checks key off it) and the broader `calendar` is ADDED so the downstream
  // client (comms session) can manage calendars/settings, not only events.
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  // Gmail: `gmail.modify` (read + write: labels, read-state, drafts) is the broad
  // grant the downstream mail client needs; `gmail.send` stays explicit (send is
  // its own capability) and `gmail.readonly` stays so existing scope-presence
  // checks (gmail.ts, settings page) remain valid — readonly ⊂ modify, so it is
  // redundant-but-harmless. Broadening is additive on purpose: under-scoping here
  // breaks the email/calendar client downstream (do not trim "to shorten consent").
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

export const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send'
export const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'
export const GMAIL_MODIFY_SCOPE = 'https://www.googleapis.com/auth/gmail.modify'
export const CALENDAR_FULL_SCOPE = 'https://www.googleapis.com/auth/calendar'

// The scopes a connect MUST come back granted for the downstream calendar + mail
// client to work. If Google returns a grant missing any of these (the user
// unchecked a box, or a stale incremental grant narrowed it), exchangeGoogleCode
// rejects the connect and forces full re-consent rather than storing a half-grant.
export const REQUIRED_CONNECT_SCOPES = [CALENDAR_FULL_SCOPE, GMAIL_MODIFY_SCOPE, GMAIL_SEND_SCOPE]

// Dual capability probe, run with the freshly-minted access token BEFORE the
// connection is ever stored as 'connected': a REAL Gmail profile read AND a REAL
// Calendar list. Both must pass. This is what makes 'connected' mean "we proved
// the grant actually works", not merely "a token arrived" (the original bug:
// status was set on token receipt, so a scoped-wrong or dead grant showed green
// until the first real sync failed). Direct fetch (no googleapis cold start);
// any error detail is scrubbed of token-like substrings before it leaves here.
export async function probeGoogleCapabilities(
  accessToken: string,
): Promise<{ ok: true } | { ok: false; detail: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` }
  try {
    const gmail = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers })
    if (!gmail.ok) {
      return {
        ok: false,
        detail: redactSecret(
          `Gmail profile read failed (HTTP ${gmail.status}: ${await snippet(gmail)})`,
        ),
      }
    }
    const cal = await fetch(
      'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1',
      { headers },
    )
    if (!cal.ok) {
      return {
        ok: false,
        detail: redactSecret(`Calendar list failed (HTTP ${cal.status}: ${await snippet(cal)})`),
      }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, detail: redactSecret(err instanceof Error ? err.message : String(err)) }
  }
}

async function snippet(r: Response): Promise<string> {
  try {
    return (await r.text()).slice(0, 150)
  } catch {
    return ''
  }
}

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

// Secret material lives in Vault (connectionStore); only connection metadata
// (status, email, scope, expiry) is queryable. REQ-SEC-01.
type GoogleSecret = {
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
  scope: string
  calendarId: string
}

export async function loadCredentials(
  tenantId: string,
  actorId?: string | null,
): Promise<GoogleOAuthCredentials | null> {
  const conn = await loadConnection<GoogleSecret>(tenantId, 'google', actorId)
  if (!conn) return null
  return {
    accountEmail: conn.info.accountEmail ?? '',
    accessToken: conn.secret.accessToken,
    refreshToken: conn.secret.refreshToken,
    expiresAt: new Date(conn.secret.expiresAt),
    scope: conn.secret.scope,
    calendarId: conn.secret.calendarId,
  }
}

export async function saveCredentials(
  tenantId: string,
  creds: GoogleOAuthCredentials,
  actorId?: string | null,
): Promise<void> {
  const secret: GoogleSecret = {
    accessToken: creds.accessToken,
    refreshToken: creds.refreshToken,
    expiresAt: creds.expiresAt.toISOString(),
    scope: creds.scope,
    calendarId: creds.calendarId,
  }
  await saveConnection(
    tenantId,
    'google',
    secret,
    {
      accountEmail: creds.accountEmail,
      scope: creds.scope,
      expiresAt: creds.expiresAt,
    },
    actorId,
  )
}

export async function deleteCredentials(tenantId: string, actorId?: string | null): Promise<void> {
  await disconnect(tenantId, 'google', actorId)
}

async function authedClient(tenantId: string, actorId?: string | null) {
  const creds = await loadCredentials(tenantId, actorId)
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
        await saveCredentials(tenantId, refreshed, actorId)
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
  actorId?: string | null,
): Promise<AvailabilitySlot[]> {
  const { oauth2, creds } = await authedClient(tenantId, actorId)
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
  actorId?: string | null,
): Promise<{ slots: AvailabilitySlot[]; source: 'google' | 'stub'; reason?: string }> {
  try {
    const slots = await getGoogleAvailability(tenantId, daysOut, actorId)
    return { slots, source: 'google' }
  } catch (err) {
    // Defense-in-depth: scrub any bearer/token-like substring before this
    // reason reaches the logs or the client-readable last_error column. The
    // OAuth token is not held in this scope (it lives inside getGoogleAvailability),
    // so the pattern backstop in redactSecret does the work.
    const reason = redactSecret(err instanceof Error ? err.message : String(err))
    console.error(
      `[getAvailability] Google availability failed for tenant ${tenantId}; falling back to stub. Reason: ${reason}`,
    )
    // Flip the connection to 'error' so Settings shows the broken sync
    // prominently instead of the UI silently serving stub slots.
    await markConnectionError(tenantId, 'google', reason, actorId).catch(() => {})
    return { slots: getStubAvailability(daysOut), source: 'stub', reason }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Workspace reads (WP7): the attorney's real calendar, day/week/month.
// ───────────────────────────────────────────────────────────────────────────

export interface WorkspaceEvent {
  eventId: string
  summary: string
  startIso: string | null
  endIso: string | null
  allDay: boolean
  htmlLink: string | null
  attendeeEmails: string[]
  status: string
}

export async function listCalendarEvents(
  tenantId: string,
  fromIso: string,
  toIso: string,
  actorId?: string | null,
): Promise<WorkspaceEvent[]> {
  const { oauth2, creds } = await authedClient(tenantId, actorId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  const res = await calendar.events.list({
    calendarId: creds.calendarId,
    timeMin: fromIso,
    timeMax: toIso,
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 250,
  })
  return (res.data.items ?? []).filter((e) => e.status !== 'cancelled').map(mapGoogleEvent)
}

function mapGoogleEvent(e: {
  id?: string | null
  summary?: string | null
  start?: { dateTime?: string | null; date?: string | null } | null
  end?: { dateTime?: string | null; date?: string | null } | null
  htmlLink?: string | null
  attendees?: Array<{ email?: string | null }> | null
  status?: string | null
}): WorkspaceEvent {
  return {
    eventId: e.id ?? '',
    summary: e.summary ?? '(no title)',
    startIso: e.start?.dateTime ?? (e.start?.date ? `${e.start.date}T00:00:00Z` : null),
    endIso: e.end?.dateTime ?? (e.end?.date ? `${e.end.date}T00:00:00Z` : null),
    allDay: Boolean(e.start?.date && !e.start?.dateTime),
    htmlLink: e.htmlLink ?? null,
    attendeeEmails: (e.attendees ?? []).map((a) => a.email ?? '').filter((x) => x.includes('@')),
    status: e.status ?? 'confirmed',
  }
}

// Fetch ONE event by id (for reconciliation). Returns null when the event is gone
// from Google — either cancelled (events.get returns status='cancelled') or hard-
// deleted (404/410). Other errors (auth, network) throw so the caller can skip and
// retry next pass rather than mis-mark a still-live event as deleted.
export async function getCalendarEvent(
  tenantId: string,
  eventId: string,
  actorId?: string | null,
): Promise<WorkspaceEvent | null> {
  const { oauth2, creds } = await authedClient(tenantId, actorId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  try {
    const res = await calendar.events.get({ calendarId: creds.calendarId, eventId })
    if (res.data.status === 'cancelled') return null
    return mapGoogleEvent(res.data)
  } catch (err) {
    // Gone from Google = 404/410. The reliable signal is response.status (a number);
    // Gaxios's err.code is often a Node string (e.g. 'ECONNRESET'), so coerce both
    // and check numerically. Any OTHER error (auth, network) re-throws so the caller
    // skips this one and retries next pass rather than mis-marking it deleted.
    const e = err as { code?: number | string; response?: { status?: number } }
    const httpStatus = Number(e?.response?.status ?? e?.code)
    if (httpStatus === 404 || httpStatus === 410) return null
    throw err
  }
}

export interface CreateEventInput {
  tenantId: string
  // The attorney whose calendar the event is created on. For the public booking
  // flow (no logged-in attorney) the caller resolves this via resolveFirmPrimaryActor.
  actorId?: string | null
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
  const { oauth2, creds } = await authedClient(input.tenantId, input.actorId)
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
  actorId?: string | null,
): Promise<void> {
  const { oauth2, creds } = await authedClient(tenantId, actorId)
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

export async function cancelEvent(
  tenantId: string,
  eventId: string,
  actorId?: string | null,
): Promise<void> {
  const { oauth2, creds } = await authedClient(tenantId, actorId)
  const calendar = google.calendar({ version: 'v3', auth: oauth2 })
  await calendar.events.delete({
    calendarId: creds.calendarId,
    eventId,
    sendUpdates: 'all',
  })
}
