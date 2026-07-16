import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  buildGoogleAuthUrl,
  disconnectGoogle,
  fetchAvailability,
  getGoogleStatus,
  type AvailabilitySlot,
  type GoogleConnectionStatus,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const statusTool: Tool<Record<string, never>, { status: GoogleConnectionStatus }> = {
  name: 'legal.google.status',
  description: 'Return whether the tenant has connected a Google account + which account.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ status: await getGoogleStatus(ctx) }),
}

const connectUrlTool: Tool<{ returnTo?: string }, { url: string }> = {
  name: 'legal.google.connect_url',
  description:
    'Generate the Google OAuth URL the attorney visits to connect their Google account. One connection grants calendar + Gmail read + Gmail send.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    // Connect the calling attorney's own Google account (per-attorney, 0016).
    url: buildGoogleAuthUrl(
      ctx.tenantId,
      input?.returnTo ?? '/attorney/settings',
      'calendar',
      ctx.actorId,
    ),
  }),
}

const disconnectTool: Tool<Record<string, never>, { disconnected: true }> = {
  name: 'legal.google.disconnect',
  description: "Forget the tenant's Google Calendar credentials.",
  mode: 'write',
  handler: async (ctx: ActionContext) => {
    await disconnectGoogle(ctx)
    return { disconnected: true as const }
  },
}

// Real Google free/busy only — when the calendar integration is unavailable
// the result is honestly empty (source 'unavailable'), never fabricated slots.
const availabilityTool: Tool<
  { daysOut?: number; serviceKey?: string },
  { slots: AvailabilitySlot[]; source: 'google' | 'unavailable'; reason?: string }
> = {
  name: 'legal.calendar.availability',
  description:
    "Return upcoming availability slots, sliced to the firm booking rules (bookable days/hours, buffer, lead time) and the service duration. Pass serviceKey to size slots to that service; omit for the firm default. Real Google Calendar free/busy only — when the calendar isn't connected the result is empty with source 'unavailable' (never sample data).",
  mode: 'read',
  handler: async (ctx: ActionContext, input) =>
    fetchAvailability(ctx, input?.daysOut ?? 14, { serviceKey: input?.serviceKey }),
}

registerTool(statusTool)
registerTool(connectUrlTool)
registerTool(disconnectTool)
registerTool(availabilityTool)
