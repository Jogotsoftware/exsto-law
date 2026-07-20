// WP FB-D — per-tenant email drafting prompt + house-voice doctrine,
// config-first (mirrors REQUIRED_DRAFTING_SLOTS / getDraftingPrompt /
// updateDraftingPrompt in services.ts, and the clear-to-default semantics of
// validateReviewPrompt / updateReviewConfig in reviewDocument.ts).
//
// Unlike the drafting prompt (per-service, per-document-kind), an email is
// FIRM-WIDE — there is one prompt and one doctrine per tenant, not per
// service. The natural home is therefore the firm_settings singleton
// (Contract K precedent: handlers/firmSettings.ts, one JSON config attribute
// per feature — invoice_template_config, manual_payment_methods_config), not
// workflow_definition.transitions (that's per-SERVICE config; email has no
// service). Both halves are stored on ONE JSON attribute
// (email_drafting_config) so they share one prompt_version, bumped whenever
// either half changes — an attorney editing the prompt and the doctrine in
// the same sitting gets one coherent version number, not two independently
// drifting ones.
//
// Migration (0180, PLANNED — see supabase/migrations_vertical) adds the
// attribute_kind_definition + action_kind_definition rows. Until it is
// applied, reads degrade safely to the repo fallback (no attribute rows can
// exist without the kind) and writes throw a clear "kind not found" error —
// the same posture every other PLANNED migration in this repo leaves its
// code in.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  HOUSE_VOICE_SLOT,
  loadEmailDraftingPromptTemplate,
  loadHouseVoiceDoctrine,
} from '../templates/loader.js'

// The slots a stored/authored email prompt MUST carry — the seven mustache
// slots generateEmail.ts / composeEmailStream.ts fill, the house-voice slot
// this module composes in, and the SUBJECT: output-format contract
// parseEmailDraftOutput's regex depends on. Analog of REQUIRED_DRAFTING_SLOTS
// (services.ts) / REQUIRED_REVIEW_SLOTS (reviewDocument.ts). Verified against
// the current templates/email-drafting-prompt.md.
export const REQUIRED_EMAIL_PROMPT_SLOTS = [
  'SUBJECT:',
  '{{purpose}}',
  '{{recipient_role}}',
  '{{matter_facts_json}}',
  '{{client_context}}',
  '{{client_brief}}',
  '{{firm_instructions}}',
  HOUSE_VOICE_SLOT,
] as const

export function missingEmailPromptSlots(promptText: string): string[] {
  return REQUIRED_EMAIL_PROMPT_SLOTS.filter((slot) => !promptText.includes(slot))
}

// Validate an attorney-authored email prompt (write-path only; reads never
// validate, so a legacy/bundled repo prompt always renders). Reject, don't
// silently patch — an email prompt missing {{matter_facts_json}} or the
// SUBJECT: contract must never reach the model.
export function validateEmailDraftingPromptText(promptText: unknown): string {
  if (typeof promptText !== 'string' || !promptText.trim()) {
    throw new Error('The email drafting prompt must be non-empty text.')
  }
  const missing = missingEmailPromptSlots(promptText)
  if (missing.length > 0) {
    throw new Error(
      `The email drafting prompt is missing required slot(s): ${missing.join(', ')}. ` +
        `Every prompt must contain ${REQUIRED_EMAIL_PROMPT_SLOTS.join(', ')} so drafting can fill them and the output can be parsed.`,
    )
  }
  return promptText
}

export interface EmailDraftingConfigDoc {
  // The RAW prompt template — still carries {{house_voice_doctrine}} unfilled
  // (composeEmailDraftingPrompt below does that substitution). This is what
  // the Settings editor shows/saves.
  promptText: string
  promptSource: 'config' | 'repo'
  // The raw house-voice doctrine text.
  houseVoiceText: string
  houseVoiceSource: 'config' | 'repo'
  // The stored config's version. Null when neither half is configured (pure
  // repo fallback) — mirrors DraftingPromptDoc.promptVersion.
  promptVersion: number | null
  requiredSlots: readonly string[]
}

interface StoredEmailDraftingConfig {
  prompt_version?: number
  // Each half: undefined/null/'' all mean "not overridden" (repo fallback).
  // Stored as null (not omitted) on an explicit clear so the write path's
  // undefined-vs-null distinction (leave alone vs clear) is unambiguous.
  prompt_text?: string | null
  house_voice_text?: string | null
}

// Pure resolver (exported for tests): config wins per half, independently —
// an attorney can override just the doctrine and keep the repo prompt, or
// vice versa. No DB, no side effects.
export function resolveEmailDraftingConfigDoc(
  stored: StoredEmailDraftingConfig | null,
): EmailDraftingConfigDoc {
  const configPrompt = stored?.prompt_text
  const configVoice = stored?.house_voice_text
  const hasConfigPrompt = typeof configPrompt === 'string' && configPrompt.trim().length > 0
  const hasConfigVoice = typeof configVoice === 'string' && configVoice.trim().length > 0
  return {
    promptText: hasConfigPrompt ? configPrompt : loadEmailDraftingPromptTemplate(),
    promptSource: hasConfigPrompt ? 'config' : 'repo',
    houseVoiceText: hasConfigVoice ? configVoice : loadHouseVoiceDoctrine(),
    houseVoiceSource: hasConfigVoice ? 'config' : 'repo',
    promptVersion: typeof stored?.prompt_version === 'number' ? stored.prompt_version : null,
    requiredSlots: REQUIRED_EMAIL_PROMPT_SLOTS,
  }
}

// Compose the FINAL prompt callers feed the model: the resolved prompt with
// {{house_voice_doctrine}} substituted by the resolved doctrine text. Pure,
// mirrors loader.ts's loadEmailDraftingPrompt() composition exactly (same
// defensive slot check, same function-replacer so `$`-patterns in an
// attorney-authored doctrine stay inert).
export function composeEmailDraftingPrompt(doc: EmailDraftingConfigDoc): string {
  if (!doc.promptText.includes(HOUSE_VOICE_SLOT)) {
    throw new Error(
      `The configured email drafting prompt is missing the ${HOUSE_VOICE_SLOT} slot — it must never draft undoctored client email.`,
    )
  }
  return doc.promptText.replace(HOUSE_VOICE_SLOT, () => doc.houseVoiceText)
}

async function readStoredEmailDraftingConfig(
  ctx: ActionContext,
): Promise<StoredEmailDraftingConfig | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ value: StoredEmailDraftingConfig | null }>(
      `SELECT a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE a.tenant_id = $1
          AND akd.kind_name = 'email_drafting_config'
          AND ekd.kind_name = 'firm_settings'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId],
    )
    return res.rows[0]?.value ?? null
  })
}

// ONE DB read, both halves resolved. generateEmail.ts / composeEmailStream.ts
// (the hot drafting paths) and the Settings editor both call this — never
// getEmailDraftingPrompt + getHouseVoiceDoctrine together, which would be two
// round trips for the same row.
export async function getEmailDraftingConfig(ctx: ActionContext): Promise<EmailDraftingConfigDoc> {
  const stored = await readStoredEmailDraftingConfig(ctx)
  return resolveEmailDraftingConfigDoc(stored)
}

// Convenience projections, named to match the drafting-prompt precedent
// (getDraftingPrompt) — each backed by the same single read above, for a
// caller that only needs one half (the MCP get tool returns both directly off
// getEmailDraftingConfig instead, to stay at one round trip).
export async function getEmailDraftingPrompt(ctx: ActionContext): Promise<{
  promptText: string
  source: 'config' | 'repo'
  promptVersion: number | null
  requiredSlots: readonly string[]
}> {
  const doc = await getEmailDraftingConfig(ctx)
  return {
    promptText: doc.promptText,
    source: doc.promptSource,
    promptVersion: doc.promptVersion,
    requiredSlots: doc.requiredSlots,
  }
}

export async function getHouseVoiceDoctrine(
  ctx: ActionContext,
): Promise<{ text: string; source: 'config' | 'repo'; promptVersion: number | null }> {
  const doc = await getEmailDraftingConfig(ctx)
  return {
    text: doc.houseVoiceText,
    source: doc.houseVoiceSource,
    promptVersion: doc.promptVersion,
  }
}

export interface UpdateEmailDraftingConfigInput {
  // undefined → leave this half unchanged; null/'' → explicitly clear it and
  // fall back to the repo default; non-empty → set a custom override.
  promptText?: string | null
  houseVoiceText?: string | null
}

// Write the firm's email drafting config as a new append-only version (a new
// email_drafting_config attribute supersedes the prior one on the firm_settings
// singleton). Validates a non-empty prompt override's required slots before
// persisting (never the doctrine — it has no slot contract of its own).
// Version bumps only when something actually changed, same discipline as
// updateReviewConfig.
export async function updateEmailDraftingConfig(
  ctx: ActionContext,
  input: UpdateEmailDraftingConfigInput,
): Promise<EmailDraftingConfigDoc> {
  if (input.promptText === undefined && input.houseVoiceText === undefined) {
    throw new Error('Nothing to update: provide promptText and/or houseVoiceText.')
  }
  const existing = await readStoredEmailDraftingConfig(ctx)

  let promptText: string | null = existing?.prompt_text ?? null
  let promptChanged = false
  if (input.promptText !== undefined) {
    const wantsCustom = typeof input.promptText === 'string' && input.promptText.trim().length > 0
    promptText = wantsCustom ? validateEmailDraftingPromptText(input.promptText) : null
    promptChanged = promptText !== (existing?.prompt_text ?? null)
  }

  let houseVoiceText: string | null = existing?.house_voice_text ?? null
  let voiceChanged = false
  if (input.houseVoiceText !== undefined) {
    const trimmedVoice = typeof input.houseVoiceText === 'string' ? input.houseVoiceText.trim() : ''
    houseVoiceText = trimmedVoice.length > 0 ? trimmedVoice : null
    voiceChanged = houseVoiceText !== (existing?.house_voice_text ?? null)
  }

  const nextVersion =
    promptChanged || voiceChanged
      ? (existing?.prompt_version ?? 0) + 1
      : (existing?.prompt_version ?? 0)

  const config: StoredEmailDraftingConfig = {
    prompt_version: nextVersion,
    prompt_text: promptText,
    house_voice_text: houseVoiceText,
  }

  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_email_drafting_config',
    intentKind: 'adjustment',
    payload: { config },
  })

  return resolveEmailDraftingConfigDoc(config)
}
