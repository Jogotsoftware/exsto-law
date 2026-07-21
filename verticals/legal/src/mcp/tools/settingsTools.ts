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
  getEngagementTemplate,
  setEngagementTemplate,
  importEngagementAgreement,
  getEmailDraftingConfig,
  updateEmailDraftingConfig,
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
  type EmailDraftingConfigDoc,
  type FirmProfileFields,
  type FirmSignature,
  type FirmBookingRules,
  type IntegrationProvider,
  type IntegrationStatus,
  type SetAttorneySignatureInput,
  type SetFirmProfileInput,
  type SetFirmSignatureInput,
  type TenantSettings,
  type UpdateEmailDraftingConfigInput,
  type UpdateTenantSettingsInput,
  type EngagementAgreementImportResult,
  type EngagementTemplateValue,
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

// ── Firm profile (P13, + WP A1, + WP FB-B, + WP FB-B2) ───────────────────────
// Firm identity as substrate config: firm_name/address/phone/email attributes on
// the firm_profile singleton, written via legal.firm.set_profile. These fields
// fill the {{firm_*}} SYSTEM merge slots on generated documents; the Settings
// "Firm details" section is their editor surface. WP A1 adds firm_jurisdiction
// (the resolveMatterJurisdiction fallback rung when a matter has no override),
// practice_areas, and attorney_name — same singleton, same action. WP FB-B adds
// assistant_instructions (migration 0175, PLANNED) — the firm's standing
// INTERNAL instructions for the AI assistant (attorney chat + AI-drafted email),
// editable on Settings → Assistant. WP FB-B2 adds portal_assistant_instructions
// (migration 0178, PLANNED) — a SEPARATE, client-safe field: the firm's standing
// guidance for the CLIENT PORTAL assistant only, editable on the same page.

registerTool({
  name: 'legal.settings.firm_profile.get',
  description:
    'Fetch the firm profile (firm name, mailing address, phone, contact email, home jurisdiction, practice areas, attorney name, assistant instructions, client portal instructions) — the identity block generated documents and letterheads resolve, plus the firm jurisdiction fallback for matters with no per-matter override, the firm-wide standing instructions the internal AI assistant (attorney chat + AI-drafted email) follows, and the separate client-safe instructions the CLIENT PORTAL assistant follows. Values come from the firm_profile record, falling back to legacy settings where never set.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ profile: await getFirmProfile(ctx) }),
} satisfies Tool<Record<string, never>, { profile: FirmProfileFields }>)

registerTool({
  name: 'legal.settings.firm_profile.set',
  description:
    'Set the firm profile (firm name, mailing address, phone, contact email, home jurisdiction, practice areas, attorney name, assistant instructions, client portal instructions). Undefined fields are left alone; an empty value clears the field. Each change is appended — prior values stay in history. Firm jurisdiction accepts a US state code or name (e.g. "NC" or "North Carolina") and is rejected if unrecognized. Assistant instructions are free text (e.g. "always CC my paralegal"), injected into the INTERNAL AI assistant chat and drafted emails — never the client portal. Client portal instructions are a SEPARATE free-text field (e.g. "mention our office closes at 5pm"), injected only into the CLIENT-FACING portal assistant. Both cap at 2,000 characters.',
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

// ── Email drafting prompt + house voice (WP FB-D) ────────────────────────────
// Config-first, firm-wide (not per-service): the attorney's own override of the
// AI email-drafting prompt and/or the house-voice doctrine, stored on the
// firm_settings singleton. Either half falls back independently to the bundled
// repo template when unset. NOT client-portal-callable (clientPolicy.ts is
// default-deny) — email drafting config is attorney-only.

registerTool({
  name: 'legal.email.prompt.get',
  description:
    "Get the firm's email drafting prompt and house-voice doctrine. Returns each half's resolved text (in-app override if saved, else the bundled repo default), its source ('config' | 'repo'), the shared config version, and the required mustache slots the prompt must carry.",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ config: await getEmailDraftingConfig(ctx) }),
} satisfies Tool<Record<string, never>, { config: EmailDraftingConfigDoc }>)

registerTool({
  name: 'legal.email.prompt.update',
  description:
    'Save the firm email drafting prompt and/or house-voice doctrine. Each field is independent: omit (undefined) to leave it unchanged, pass null/empty to clear it back to the bundled repo default, or pass text to set a custom override. A custom prompt must contain every required slot (see legal.email.prompt.get) — the save is rejected otherwise. Bumps the shared config version when either half actually changes; the drafting worker and the "Draft with AI" compose box use the new config immediately.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => ({
    config: await updateEmailDraftingConfig(ctx, input),
  }),
} satisfies Tool<UpdateEmailDraftingConfigInput, { config: EmailDraftingConfigDoc }>)

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

// ── ENGAGEMENT-DOC-1 — the firm's engagement-agreement template ──────────────
// Upload flow: the settings page parses the PDF via /api/attorney/templates/import
// (stateless), then hands the markdown here — this tool runs the AI conversion,
// creates the template (client signs; firm block pre-signed), and points the firm
// at it. The portal gate reads the pointer through legal.client.engagement.

registerTool({
  name: 'legal.firm.get_engagement_agreement',
  description:
    "Get the firm's engagement-agreement template pointer: {template_id, version, uploaded_at, source_filename, details} or null when no agreement has been uploaded (the portal gate then shows text terms only).",
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ agreement: await getEngagementTemplate(ctx) }),
} satisfies Tool<Record<string, never>, { agreement: EngagementTemplateValue | null }>)

registerTool({
  name: 'legal.firm.import_engagement_agreement',
  description:
    'Convert an uploaded engagement letter (parsed markdown) into the firm engagement-agreement merge template and set the firm pointer to it. Client-specific values become merge fields; the client acceptance block gets {{sign:client}}/{{date:client}} markers; rates/retainer are extracted into details. Replaces any prior agreement pointer (prior template stays in history).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) =>
    await importEngagementAgreement(ctx, {
      markdown: input.markdown,
      sourceFilename: input.sourceFilename,
    }),
} satisfies Tool<{ markdown: string; sourceFilename?: string }, EngagementAgreementImportResult>)

registerTool({
  name: 'legal.firm.clear_engagement_agreement',
  description:
    'Clear the firm engagement-agreement template pointer. The portal gate falls back to text-terms-only acceptance; the template itself is not deleted.',
  mode: 'write',
  handler: async (ctx: ActionContext) => await setEngagementTemplate(ctx, { templateId: null }),
} satisfies Tool<Record<string, never>, { templateId: string | null; version?: number }>)
