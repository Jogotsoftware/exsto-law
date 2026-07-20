import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  connectIntegration,
  disconnectGranola,
  disconnectIntegration,
  getAttorneyActorEmail,
  getAttorneySignature,
  getFirmSignature,
  getFirmBookingRules,
  getOwnPublicSlug,
  getFirmDefaultRate,
  setFirmDefaultRate,
  getFirmProfile,
  setFirmProfile,
  getTenantSettings,
  listIntegrationStatuses,
  setAttorneySignature,
  setFirmSignature,
  updateFirmBookingRules,
  updateTenantSettings,
  type AttorneySignature,
  type ConnectIntegrationInput,
  type ConnectResult,
  type FirmProfileFields,
  type FirmSignature,
  type FirmBookingRules,
  type IntegrationProvider,
  type IntegrationStatus,
  type SetAttorneySignatureInput,
  type SetFirmProfileInput,
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

// ── Firm profile (P13, + WP A1) ──────────────────────────────────────────────
// Firm identity as substrate config: firm_name/address/phone/email attributes on
// the firm_profile singleton, written via legal.firm.set_profile. These fields
// fill the {{firm_*}} SYSTEM merge slots on generated documents; the Settings
// "Firm details" section is their editor surface. WP A1 adds firm_jurisdiction
// (the resolveMatterJurisdiction fallback rung when a matter has no override),
// practice_areas, and attorney_name — same singleton, same action.

registerTool({
  name: 'legal.settings.firm_profile.get',
  description:
    'Fetch the firm profile (firm name, mailing address, phone, contact email, home jurisdiction, practice areas, attorney name) — the identity block generated documents and letterheads resolve, plus the firm jurisdiction fallback for matters with no per-matter override. Values come from the firm_profile record, falling back to legacy settings where never set.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ profile: await getFirmProfile(ctx) }),
} satisfies Tool<Record<string, never>, { profile: FirmProfileFields }>)

registerTool({
  name: 'legal.settings.firm_profile.set',
  description:
    'Set the firm profile (firm name, mailing address, phone, contact email, home jurisdiction, practice areas, attorney name). Undefined fields are left alone; an empty value clears the field. Each change is appended — prior values stay in history. Firm jurisdiction accepts a US state code or name (e.g. "NC" or "North Carolina") and is rejected if unrecognized.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({ profile: await setFirmProfile(ctx, input) }),
} satisfies Tool<SetFirmProfileInput, { profile: FirmProfileFields }>)

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
    'Set the firm email signature (plain text + optional rich signatureHtml with formatting/links/photos) and/or its enabled flag. Undefined fields are left alone; an empty signature clears it (sends then fall back to the firm-derived default). Applies to every subsequent outbound client email.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => {
    const { signature } = await setFirmSignature(ctx, input)
    return { signature, sendAsDisplayName: FIRM_SENDER_DISPLAY_NAME }
  },
} satisfies Tool<SetFirmSignatureInput, SignatureGetResult>)

// ── Attorney signature (P15) ─────────────────────────────────────────────────
// The signed-in attorney's standing signature (typed / drawn / uploaded), stored
// on their per-actor attorney_profile via legal.attorney.signature_set and
// applied when they sign documents electronically. `attorneyEmail` lets the sign
// pages prefill only on the attorney's OWN signature request.

interface AttorneySignatureGetResult {
  signature: AttorneySignature | null
  attorneyEmail: string | null
}

registerTool({
  name: 'legal.settings.attorney_signature.get',
  description:
    "Fetch the signed-in attorney's saved signature (typed name, drawn image, or uploaded image; null when never saved) plus their account email.",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({
    signature: await getAttorneySignature(ctx),
    attorneyEmail: await getAttorneyActorEmail(ctx),
  }),
} satisfies Tool<Record<string, never>, AttorneySignatureGetResult>)

registerTool({
  name: 'legal.settings.attorney_signature.set',
  description:
    "Set the signed-in attorney's standing signature. mode 'typed' needs a non-empty name; 'drawn'/'uploaded' need a PNG or JPEG data URL under 500 KB. Each save is appended — prior signatures stay in history. Applied when the attorney signs documents electronically.",
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    signature: await setAttorneySignature(ctx, input),
  }),
} satisfies Tool<SetAttorneySignatureInput, { signature: AttorneySignature | null }>)

// ── Firm booking rules (Contract L) ──────────────────────────────────────────

registerTool({
  name: 'legal.booking_rules.get',
  description:
    'Fetch the firm booking rules: bookable days/hours, meeting lengths offered, buffer between calls, minimum lead time, slot granularity, and default consultation duration — plus the firm public booking slug (for the standalone /book/{slug} link).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({
    rules: await getFirmBookingRules(ctx),
    publicSlug: await getOwnPublicSlug(ctx),
  }),
} satisfies Tool<Record<string, never>, { rules: FirmBookingRules; publicSlug: string | null }>)

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
