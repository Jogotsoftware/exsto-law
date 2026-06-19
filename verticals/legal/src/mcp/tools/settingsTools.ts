import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  connectIntegration,
  disconnectGranola,
  disconnectIntegration,
  getFirmBookingRules,
  getTenantSettings,
  listIntegrationStatuses,
  updateFirmBookingRules,
  updateTenantSettings,
  type ConnectIntegrationInput,
  type ConnectResult,
  type FirmBookingRules,
  type IntegrationProvider,
  type IntegrationStatus,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// ── Tenant settings (firm info + defaults) ───────────────────────────────────

registerTool({
  name: 'legal.settings.get',
  description: 'Fetch firm-level settings (firm name, attorney, contact, defaults).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ settings: await getTenantSettings(ctx) }),
} satisfies Tool<Record<string, never>, { settings: TenantSettings }>)

registerTool({
  name: 'legal.settings.update',
  description: 'Update firm-level settings. Undefined fields are left alone.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    settings: await updateTenantSettings(ctx, input),
  }),
} satisfies Tool<UpdateTenantSettingsInput, { settings: TenantSettings }>)

// ── Firm booking rules (Contract L) ──────────────────────────────────────────

registerTool({
  name: 'legal.booking_rules.get',
  description:
    'Fetch the firm booking rules: bookable days/hours, buffer between calls, minimum lead time, slot granularity, and default consultation duration.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ rules: await getFirmBookingRules(ctx) }),
} satisfies Tool<Record<string, never>, { rules: FirmBookingRules }>)

registerTool({
  name: 'legal.booking_rules.update',
  description:
    'Update the firm booking rules. Undefined fields are left alone; every value is clamped to a safe range before it is saved.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    rules: await updateFirmBookingRules(ctx, input),
  }),
} satisfies Tool<Partial<FirmBookingRules>, { rules: FirmBookingRules }>)

// ── Integrations ─────────────────────────────────────────────────────────────

registerTool({
  name: 'legal.integration.list',
  description:
    'List all third-party integrations and their connection status. Credentials are never returned, only last_four for masking.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ integrations: await listIntegrationStatuses(ctx) }),
} satisfies Tool<Record<string, never>, { integrations: IntegrationStatus[] }>)

registerTool({
  name: 'legal.integration.connect',
  description:
    'Verify and persist an API-key credential for a third-party integration. Server pings the provider before saving.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => connectIntegration(ctx, input),
} satisfies Tool<ConnectIntegrationInput, ConnectResult>)

registerTool({
  name: 'legal.integration.disconnect',
  description: 'Delete the stored credential for a third-party integration.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    await disconnectIntegration(ctx, input.provider)
    return { ok: true }
  },
} satisfies Tool<{ provider: IntegrationProvider }, { ok: true }>)

// Granola is OAuth (per-attorney), not an api-key provider — connect happens via
// the browser flow (/api/auth/granola/*); this is its disconnect (WP1.2).
registerTool({
  name: 'legal.granola.disconnect',
  description: "Disconnect the signed-in attorney's Granola OAuth connection.",
  mode: 'write',
  handler: async (ctx: ActionContext) => {
    await disconnectGranola(ctx)
    return { ok: true }
  },
} satisfies Tool<Record<string, never>, { ok: true }>)
