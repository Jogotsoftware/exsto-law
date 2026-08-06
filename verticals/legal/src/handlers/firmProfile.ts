import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import { insertAttribute, insertEntity, lookupKindId } from './common.js'
import { normalizeJurisdiction } from '../api/jurisdictions.js'

// ───────────────────────────────────────────────────────────────────────────
// Firm profile fields (P13, + WP A1). The firm_profile singleton (migration 0053)
// holds firm-wide config; migration 0161 adds the identity attribute kinds
// (firm_name / firm_address / firm_phone / firm_email) that generated documents
// resolve as SYSTEM merge slots. Migration 0170 (WP A1) adds firm_jurisdiction /
// practice_areas / attorney_name — the firm's home jurisdiction (matter>firm>
// unset resolver fallback rung), practice areas, and lead attorney display name.
// Migration 0175 (WP FB-B, PLANNED — not applied) adds assistant_instructions —
// the firm's standing custom instructions for the AI assistant (e.g. "always CC
// my paralegal"), injected into the attorney chat's stable system prompt and the
// email-drafting prompt (assistantPrompt.ts buildFirmInstructionsBlock). Same
// singleton, same action, same append-only-supersede pattern as every other
// profile field.
// Migration 0178 (WP FB-B2, PLANNED — not applied) adds
// portal_assistant_instructions — a SEPARATE, client-safe field: the firm's
// standing guidance for the CLIENT-FACING portal assistant (e.g. "mention our
// office closes at 5pm"), injected only into the portal chat's system prompt
// (assistantPrompt.ts buildPortalInstructionsBlock, via clientAssistantChat.ts).
// It never reaches the attorney chat or the email-drafting prompt — those stay
// on assistant_instructions alone, and the portal never reads that internal
// field either (leak risk was the whole reason FB-B excluded the portal).
// legal.firm.set_profile creates the singleton on first write and supersedes its
// attributes append-only — the exact legal.firm.signature_set pattern
// (handlers/firmSignature.ts).
// ───────────────────────────────────────────────────────────────────────────

const FIRM_PROFILE_ENTITY_KIND = 'firm_profile'

// The per-tenant firm_profile is a singleton: find the existing one, or create it.
async function getOrCreateFirmProfile(
  client: DbClient,
  tenantId: string,
  actionId: string,
): Promise<string> {
  // Serialize concurrent first-writes: two parallel saves would both see no
  // profile and mint two singletons (one save's attributes land on the row no
  // reader picks). Xact-scoped, so the lock releases at the action's commit.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${tenantId}:firm_profile`])
  const kindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    FIRM_PROFILE_ENTITY_KIND,
  )
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM entity
       WHERE tenant_id = $1 AND entity_kind_id = $2 AND status = 'active'
       ORDER BY recorded_at ASC LIMIT 1`,
    [tenantId, kindId],
  )
  if (existing.rows[0]) return existing.rows[0].id
  return insertEntity(client, tenantId, actionId, kindId, 'Firm profile', {})
}

async function setProfileAttr(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    entityId: string
    kind: string
    value: unknown
  },
): Promise<void> {
  const akId = await lookupKindId(client, 'attribute_kind_definition', args.tenantId, args.kind)
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: args.entityId,
    attributeKindId: akId,
    value: args.value,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })
}

interface FirmProfileSetPayload {
  // Each field: undefined leaves it unchanged; null/'' (null/[] for
  // practice_areas) clears it.
  firm_name?: string | null
  firm_address?: string | null
  firm_phone?: string | null
  firm_email?: string | null
  firm_jurisdiction?: string | null
  practice_areas?: unknown
  attorney_name?: string | null
  // FB-B (migration 0175, PLANNED) — the firm's standing instructions for the
  // AI assistant. ITEM-12 WP-2 — now an array of pills (one instruction per
  // Enter-to-add pill in Settings → Assistant), same shape/semantics as
  // practice_areas below (a non-array clears; see normalizeFirmProfileFieldValue).
  assistant_instructions?: unknown
  // FB-B2 (migration 0178, PLANNED) — the firm's standing, client-safe
  // instructions for the CLIENT PORTAL assistant. Independent of
  // assistant_instructions above; same array-of-pills shape.
  portal_assistant_instructions?: unknown
  // UIWALK-1 (migration 0196) — the firm's top-bar color as '#rrggbb'; '' clears.
  firm_header_color?: string | null
  // FIRM-BRANDING-1 (migration 0202) — the firm's logo as an image data URL;
  // '' clears (chrome falls back to the crest / wordmark).
  firm_logo?: string | null
  // FIRM-BRANDING-1 (migration 0203) — 'light' | 'dark', the tone of the ink in
  // that logo, measured by the uploader; '' clears (unknown → render bare).
  firm_logo_tone?: string | null
  // BRANDING-SECTION-1 (migration 0204) — the firm's SECOND brand color as
  // '#rrggbb'; '' clears (companion tones go back to derived-from-primary).
  firm_secondary_color?: string | null
  // BRANDING-SECTION-1 (migration 0204) — the HEADER logo (attorney console top
  // bar only) as an image data URL, and its measured tone; '' clears either.
  firm_logo_secondary?: string | null
  firm_logo_secondary_tone?: string | null
  // FIRM-LANDING-2 (migration 0200) — the public landing page's hero tagline
  // and about paragraph. Plain text, trimmed, '' clears; length-capped below
  // (these render verbatim on the firm's public page — a paste-a-document
  // value is a mistake, not a tagline).
  firm_tagline?: string | null
  firm_about?: string | null
}

const PROFILE_FIELDS = [
  'firm_name',
  'firm_address',
  'firm_phone',
  'firm_email',
  'firm_jurisdiction',
  'practice_areas',
  'attorney_name',
  'assistant_instructions',
  'portal_assistant_instructions',
  'firm_header_color',
  'firm_logo',
  'firm_logo_tone',
  'firm_secondary_color',
  'firm_logo_secondary',
  'firm_logo_secondary_tone',
  'firm_tagline',
  'firm_about',
] as const

type ProfileField = (typeof PROFILE_FIELDS)[number]

// ITEM-12 WP-2 — shared array-of-pills normalizer for assistant_instructions /
// portal_assistant_instructions: trims each item, drops empties, dedupes
// case-insensitively (same discipline as practice_areas), and additionally
// caps each item at 500 chars and the whole list at 20 items — pills are
// short standing instructions, not a place to paste a document, and an
// unbounded list would defeat the point of a scannable pill row. A non-array
// input clears the field, fails safe like practice_areas.
const INSTRUCTIONS_ITEM_CHAR_CAP = 500
const INSTRUCTIONS_MAX_ITEMS = 20

// FIRM-LANDING-2 — public-page copy caps. A tagline is one hero line; the
// about block is one readable paragraph (or a few). Over-cap input is
// REJECTED, not silently truncated (see normalizeFirmProfileFieldValue).
const TAGLINE_CHAR_CAP = 160
const ABOUT_CHAR_CAP = 4000

// FIRM-BRANDING-1 — the firm logo is stored inline as an image data URL (the
// same shape the invoice template has always stored), so it needs no blob
// store and every surface that reads the profile can render it directly. Two
// guards, both REJECT rather than truncate:
//   * only a raster image data URL — an arbitrary string here would be
//     interpolated into `src` on every public page (svg+xml is excluded on
//     purpose: an SVG is executable markup, not a picture);
//   * a size cap, because this value rides in the settings payload of every
//     branded surface. 700 KB of base64 ≈ a 500 KB image, the cap the uploader
//     has always enforced client-side.
const LOGO_DATA_URL_RE = /^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/
const LOGO_CHAR_CAP = 700_000

function normalizeInstructionsPills(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const items: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim().slice(0, INSTRUCTIONS_ITEM_CHAR_CAP)
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue
    seen.add(trimmed.toLowerCase())
    items.push(trimmed)
    if (items.length >= INSTRUCTIONS_MAX_ITEMS) break
  }
  return items
}

// PURE validation/normalization, exported for unit tests (tests/vertical). Text
// fields are stored trimmed; '' means "cleared" (readers report it as null).
// firm_jurisdiction must normalize to a canonical US state code (or be empty, to
// clear) — an unrecognized value is rejected rather than silently stored garbage
// a resolver could never match. practice_areas is deduped, trimmed, empty-string
// entries dropped; a non-array input clears the field (fails safe, not silently
// keeps a stale array). assistant_instructions / portal_assistant_instructions
// follow the same array shape (normalizeInstructionsPills above), with a per-item
// and total-list cap on top.
export function normalizeFirmProfileFieldValue(kind: ProfileField, raw: unknown): unknown {
  if (kind === 'practice_areas') {
    if (!Array.isArray(raw)) return []
    const seen = new Set<string>()
    const areas: string[] = []
    for (const entry of raw) {
      if (typeof entry !== 'string') continue
      const trimmed = entry.trim()
      if (!trimmed || seen.has(trimmed.toLowerCase())) continue
      seen.add(trimmed.toLowerCase())
      areas.push(trimmed)
    }
    return areas
  }
  if (kind === 'assistant_instructions' || kind === 'portal_assistant_instructions') {
    return normalizeInstructionsPills(raw)
  }
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (kind === 'firm_tagline' && text.length > TAGLINE_CHAR_CAP) {
    // Rejected loudly (like firm_jurisdiction/firm_header_color), never silently
    // truncated — the tagline renders verbatim on the public landing hero.
    throw new Error(
      `firm_tagline must be at most ${TAGLINE_CHAR_CAP} characters (got ${text.length}); leave empty to clear.`,
    )
  }
  if (kind === 'firm_about' && text.length > ABOUT_CHAR_CAP) {
    throw new Error(
      `firm_about must be at most ${ABOUT_CHAR_CAP} characters (got ${text.length}); leave empty to clear.`,
    )
  }
  // BRANDING-SECTION-1 — the same three guards now cover both brand colors and
  // both logo slots. One rule per SHAPE, not per field, so a future slot cannot
  // be added with weaker validation than its sibling.
  if ((kind === 'firm_header_color' || kind === 'firm_secondary_color') && text) {
    // Store only a well-formed hex color — anything else would be injected
    // verbatim into an inline style on every page's header.
    if (!/^#[0-9a-fA-F]{6}$/.test(text)) {
      throw new Error(
        `${kind} must be a hex color like #1b2a4a (got "${text}"); leave empty to clear.`,
      )
    }
    return text.toLowerCase()
  }
  if ((kind === 'firm_logo' || kind === 'firm_logo_secondary') && text) {
    if (text.length > LOGO_CHAR_CAP) {
      throw new Error(
        `${kind} is too large (${text.length} characters); use an image under 500 KB. Leave empty to clear.`,
      )
    }
    if (!LOGO_DATA_URL_RE.test(text)) {
      throw new Error(
        `${kind} must be a PNG/JPG/GIF/WEBP image data URL (data:image/png;base64,…); leave empty to clear.`,
      )
    }
    return text
  }
  if ((kind === 'firm_logo_tone' || kind === 'firm_logo_secondary_tone') && text) {
    if (text !== 'light' && text !== 'dark') {
      throw new Error(`${kind} must be 'light' or 'dark' (got "${text}"); leave empty to clear.`)
    }
    return text
  }
  if (kind === 'firm_jurisdiction' && text) {
    const code = normalizeJurisdiction(text)
    if (!code) {
      throw new Error(
        `firm_jurisdiction must be a valid US state code or name (got "${text}"); leave empty to clear.`,
      )
    }
    return code
  }
  return text
}

registerActionHandler('legal.firm.set_profile', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as FirmProfileSetPayload
  const provided = PROFILE_FIELDS.filter((k) => p[k] !== undefined)
  if (provided.length === 0) {
    throw new Error(
      'Nothing to update: provide at least one of firm_name, firm_address, firm_phone, firm_email, firm_jurisdiction, practice_areas, attorney_name, assistant_instructions, portal_assistant_instructions, firm_header_color, firm_secondary_color, firm_logo, firm_logo_tone, firm_logo_secondary, firm_logo_secondary_tone, firm_tagline, firm_about.',
    )
  }

  // Validate/normalize every field BEFORE any write — a rejected value (e.g. an
  // unrecognized jurisdiction) must leave every field in this call untouched, not
  // just the ones processed before it (the transaction rolls back either way, but
  // failing fast here keeps the intent obvious).
  const values = new Map<ProfileField, unknown>()
  for (const kind of provided) {
    values.set(kind, normalizeFirmProfileFieldValue(kind, p[kind]))
  }

  const firmProfileId = await getOrCreateFirmProfile(client, ctx.tenantId, actionId)

  const updated: string[] = []
  for (const kind of provided) {
    await setProfileAttr(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      entityId: firmProfileId,
      kind,
      value: values.get(kind),
    })
    updated.push(kind)
  }

  return { firmProfileId, updated }
})
