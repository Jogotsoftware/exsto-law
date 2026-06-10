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
  description: 'Generate the Google OAuth URL the attorney should visit to connect their calendar.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    url: buildGoogleAuthUrl(ctx.tenantId, input?.returnTo ?? '/attorney/settings'),
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

// Override the existing calendar.availability tool to use the real Google
// path when connected (falls back to stub).
const availabilityTool: Tool<
  { daysOut?: number },
  { slots: AvailabilitySlot[]; source: 'google' | 'stub' }
> = {
  name: 'legal.calendar.availability',
  description:
    'Return upcoming availability slots. Real Google Calendar when connected; stub otherwise.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => fetchAvailability(ctx, input?.daysOut ?? 14),
}

registerTool(statusTool)
registerTool(connectUrlTool)
registerTool(disconnectTool)
registerTool(availabilityTool)
