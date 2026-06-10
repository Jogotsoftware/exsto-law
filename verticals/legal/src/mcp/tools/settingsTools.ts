import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  connectIntegration,
  disconnectIntegration,
  getTenantSettings,
  listIntegrationStatuses,
  updateTenantSettings,
  type ConnectIntegrationInput,
  type ConnectResult,
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
