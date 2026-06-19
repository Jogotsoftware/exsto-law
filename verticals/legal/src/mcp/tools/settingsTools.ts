import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  connectIntegration,
  disconnectGranola,
  disconnectIntegration,
  getFirmSignature,
  getFirmBookingRules,
  getFirmDefaultRate,
  setFirmDefaultRate,
  getTenantSettings,
  listIntegrationStatuses,
  setFirmSignature,
  updateFirmBookingRules,
  updateTenantSettings,
  type ConnectIntegrationInput,
  type ConnectResult,
  type FirmSignature,
  type FirmBookingRules,
  type IntegrationProvider,
  type IntegrationStatus,
  type SetFirmSignatureInput,
  type TenantSettings,
  type UpdateTenantSettingsInput,
} from '../../index.js'
import { FIRM_SENDER_DISPLAY_NAME } from '../../adapters/gmail.js'
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

// ── Email signature (fix #10) ────────────────────────────────────────────────
// The signature is applied in the central Contract B send path; this is its
// editor surface. `sendAsDisplayName` is the read-out of the firm sender name
// every outbound client email goes out under.

interface SignatureGetResult {
  signature: FirmSignature
  sendAsDisplayName: string
}

registerTool({
  name: 'legal.settings.signature.get',
  description:
    'Fetch the firm email signature (stored text, enabled flag, the resolved text the send path would append, whether it is the firm-derived default) plus the outbound sender display name.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({
    signature: await getFirmSignature(ctx),
    sendAsDisplayName: FIRM_SENDER_DISPLAY_NAME,
  }),
} satisfies Tool<Record<string, never>, SignatureGetResult>)

registerTool({
  name: 'legal.settings.signature.set',
  description:
    'Set the firm email signature and/or its enabled flag. Undefined fields are left alone; an empty signature clears it (sends then fall back to the firm-derived default). Applies to every subsequent outbound client email.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    const { signature } = await setFirmSignature(ctx, input)
    return { signature, sendAsDisplayName: FIRM_SENDER_DISPLAY_NAME }
  },
} satisfies Tool<SetFirmSignatureInput, SignatureGetResult>)

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

// ── Firm default billing rate (Contract K) ───────────────────────────────────

registerTool({
  name: 'legal.firm.get_default_rate',
  description:
    'Fetch the firm-wide default hourly rate — the fallback used on invoices when a client has no explicit billable rate. Null if never set.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ rate: await getFirmDefaultRate(ctx) }),
} satisfies Tool<Record<string, never>, { rate: string | null }>)

registerTool({
  name: 'legal.firm.set_default_rate',
  description:
    'Set the firm-wide default hourly rate. Decimal string (ADR 0044), e.g. "350.00". Appended as a new effective-dated fact; the prior rate stays in history.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => await setFirmDefaultRate(ctx, input.rate),
} satisfies Tool<{ rate: string }, { rate: string }>)

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
