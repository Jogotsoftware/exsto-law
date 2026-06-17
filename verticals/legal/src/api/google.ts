import { randomUUID } from 'node:crypto'
import {
  GOOGLE_OAUTH_SCOPES_CONNECT,
  GOOGLE_OAUTH_SCOPES_SIGNIN,
  buildOAuthClient,
  cancelEvent,
  createBookingEvent,
  deleteCredentials,
  getAvailability,
  getOAuthClientConfig,
  loadCredentials,
  rescheduleEvent,
  saveCredentials,
  type AvailabilitySlot,
  type CreatedEvent,
} from '../adapters/googleCalendar.js'
import { lookupActorByEmail } from './identity.js'
import { signOAuthState, verifyOAuthState } from '../adapters/oauthState.js'
import { resolveFirmPrimaryActor } from '../adapters/connectionStore.js'
import type { ActionContext } from '@exsto/substrate'

export type GoogleAuthMode = 'signin' | 'calendar' | 'mail'

export interface GoogleConnectionStatus {
  connected: boolean
  accountEmail: string | null
  calendarId: string | null
  scope: string | null
  expiresAt: string | null
}

// Google is per-attorney (migration 0016). By default this reads the signed-in
// attorney's own connection (ctx.actorId). Firm-level callers (the public
// booking page) pass an explicit actorId — the firm's primary attorney — so
// they don't read the anonymous intake actor's (non-existent) connection.
export async function getGoogleStatus(
  ctx: ActionContext,
  actorIdOverride?: string | null,
): Promise<GoogleConnectionStatus> {
  const actorId = actorIdOverride === undefined ? ctx.actorId : actorIdOverride
  const creds = await loadCredentials(ctx.tenantId, actorId)
  if (!creds)
    return { connected: false, accountEmail: null, calendarId: null, scope: null, expiresAt: null }
  return {
    connected: true,
    accountEmail: creds.accountEmail,
    calendarId: creds.calendarId,
    scope: creds.scope,
    expiresAt: creds.expiresAt.toISOString(),
  }
}

export function buildGoogleAuthUrl(
  tenantId: string,
  returnTo: string,
  mode: GoogleAuthMode = 'calendar',
  actorId?: string | null,
): string {
  const oauth2 = buildOAuthClient()
  // HMAC-signed so the browser can't tamper with tenantId/returnTo/mode/actorId.
  // actorId binds the connecting attorney into the state for calendar/mail mode,
  // so the callback stores credentials under THAT attorney (per-attorney, 0016).
  const state = signOAuthState({
    tenantId,
    returnTo,
    mode,
    actorId: actorId ?? null,
    nonce: randomUUID(),
  })
  // Any non-signin connect (calendar or mail mode) requests the FULL set —
  // one Google connection covers calendar + Gmail read + Gmail send. offline +
  // consent so we always get a refresh token and the user sees the full grant.
  const scope = mode === 'signin' ? GOOGLE_OAUTH_SCOPES_SIGNIN : GOOGLE_OAUTH_SCOPES_CONNECT
  return oauth2.generateAuthUrl({
    access_type: mode === 'signin' ? 'online' : 'offline',
    prompt: mode === 'signin' ? 'select_account' : 'consent',
    scope,
    state,
  })
}

export interface ExchangeResult {
  tenantId: string
  returnTo: string
  mode: GoogleAuthMode
  accountEmail: string
  storedCredentials: boolean
  // Populated for signin mode after the DB lookup resolves email → actor.
  // Null in calendar mode (we don't need them; calendar uses the tenant from
  // the state payload). Also null in signin mode if the email is unknown —
  // the caller should reject the sign-in in that case.
  actorId: string | null
  displayName: string | null
}

export async function exchangeGoogleCode(state: string, code: string): Promise<ExchangeResult> {
  // Verify the HMAC before trusting ANY field. A tampered or unsigned state
  // (forged tenantId/returnTo) is rejected here, fail-closed.
  let parsedState: {
    tenantId: string
    returnTo: string
    mode?: GoogleAuthMode
    actorId?: string | null
    nonce: string
  }
  try {
    parsedState = verifyOAuthState(state)
  } catch {
    throw new Error('Invalid OAuth state.')
  }
  // Default to 'signin' (identity-only, no DB write) so a malformed or
  // stale state never accidentally trips the calendar-mode DB save path.
  const mode: GoogleAuthMode =
    parsedState.mode === 'calendar' ? 'calendar' : parsedState.mode === 'mail' ? 'mail' : 'signin'

  // Direct fetch for the token exchange — avoids the heavy googleapis cold
  // start in Netlify Functions. Saves ~3-5 seconds on first invocation.
  const cfg = getOAuthClientConfig()
  if (!cfg) throw new Error('Google OAuth not configured in env vars.')

  const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenResp.ok) {
    const errText = await tokenResp.text()
    throw new Error(`Token exchange failed (${tokenResp.status}): ${errText.slice(0, 200)}`)
  }
  const tokens = (await tokenResp.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    scope?: string
    id_token?: string
  }
  if (!tokens.access_token) throw new Error('Token exchange returned no access token.')

  // Fetch the email via userinfo (direct fetch, no SDK).
  const userinfoResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!userinfoResp.ok) {
    throw new Error(`userinfo fetch failed (${userinfoResp.status})`)
  }
  const userinfo = (await userinfoResp.json()) as { email?: string }
  const email = userinfo.email ?? 'unknown@unknown'

  let stored = false
  let resolvedActorId: string | null = null
  let resolvedDisplayName: string | null = null
  let resolvedTenantId = parsedState.tenantId

  if (mode === 'signin') {
    // Email → actor lookup. Unknown emails return null here; the route
    // surfaces a friendly rejection page.
    const resolved = await lookupActorByEmail(email)
    if (resolved) {
      resolvedActorId = resolved.actorId
      resolvedTenantId = resolved.tenantId
      resolvedDisplayName = resolved.displayName
    }
  } else if (mode === 'calendar' || mode === 'mail') {
    if (!tokens.refresh_token) {
      throw new Error(
        'No refresh token returned. Re-authorize with consent screen (revoke at https://myaccount.google.com/permissions and try again).',
      )
    }
    const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000)
    // Store under the connecting attorney bound into the signed state — never a
    // value from the request — so one attorney can't overwrite another's tokens.
    await saveCredentials(
      parsedState.tenantId,
      {
        accountEmail: email,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt,
        scope: tokens.scope ?? GOOGLE_OAUTH_SCOPES_CONNECT.join(' '),
        calendarId: 'primary',
      },
      parsedState.actorId ?? null,
    )
    stored = true
  }

  return {
    tenantId: resolvedTenantId,
    returnTo: parsedState.returnTo,
    mode,
    accountEmail: email,
    storedCredentials: stored,
    actorId: resolvedActorId,
    displayName: resolvedDisplayName,
  }
}

export async function disconnectGoogle(ctx: ActionContext): Promise<void> {
  await deleteCredentials(ctx.tenantId, ctx.actorId)
}

export async function fetchAvailability(
  ctx: ActionContext,
  daysOut: number,
): Promise<{ slots: AvailabilitySlot[]; source: 'google' | 'stub' }> {
  // Public booking page: no signed-in attorney, so read the firm's primary
  // connected attorney's calendar. (Per-link attorney selection is track B.)
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  return getAvailability(ctx.tenantId, daysOut, firmActor)
}

export interface CreateBookingEventArgs {
  matterEntityId: string
  matterNumber: string
  clientFullName: string
  clientEmail: string
  serviceDisplayName: string
  scheduledAtIso: string
  scheduledEndIso: string
  intakeSummary?: string
}

const ATTORNEY_FALLBACK_EMAIL = 'juancarlos@pachecolaw.com'

export async function tryCreateBookingEvent(
  ctx: ActionContext,
  args: CreateBookingEventArgs,
): Promise<CreatedEvent | null> {
  // Public booking: book on the firm's primary connected attorney's calendar.
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  const status = await getGoogleStatus(ctx, firmActor)
  if (!status.connected) return null
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL ?? process.env.URL ?? 'https://exstolaw.netlify.app'
  const attorneyEmail = status.accountEmail ?? ATTORNEY_FALLBACK_EMAIL

  const descriptionHtml = `
<b>Pacheco Law consultation</b><br>
${args.serviceDisplayName} &middot; ${args.clientFullName}
<br><br>
${args.intakeSummary ? `<b>Intake summary:</b><br>${args.intakeSummary}<br><br>` : ''}
<b>Matter:</b> ${args.matterNumber}
  `.trim()

  try {
    return await createBookingEvent({
      tenantId: ctx.tenantId,
      actorId: firmActor,
      summary: `Pacheco Law — ${args.serviceDisplayName} (${args.clientFullName})`,
      descriptionHtml,
      startIso: args.scheduledAtIso,
      endIso: args.scheduledEndIso,
      attorneyEmail,
      clientEmail: args.clientEmail,
      clientName: args.clientFullName,
      matterId: args.matterEntityId,
      matterReschedulePath: `/book/reschedule/${args.matterEntityId}`,
      bookingBaseUrl: baseUrl,
    })
  } catch (error) {
    console.error('[google-calendar] createBookingEvent failed:', error)
    return null
  }
}

export async function rescheduleBookingEvent(
  ctx: ActionContext,
  eventId: string,
  newStartIso: string,
  newEndIso: string,
): Promise<void> {
  // Client-initiated reschedule from the public booking link: the event lives on
  // the firm's primary attorney's calendar (per-matter assignment is track C).
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  return rescheduleEvent(ctx.tenantId, eventId, newStartIso, newEndIso, firmActor)
}

export async function cancelBookingEvent(ctx: ActionContext, eventId: string): Promise<void> {
  const firmActor = await resolveFirmPrimaryActor(ctx.tenantId, 'google')
  return cancelEvent(ctx.tenantId, eventId, firmActor)
}
