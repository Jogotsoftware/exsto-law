// CONTEXT-SETTINGS-1 — the firm's AI Context settings: per-capability standing
// instructions plus the firm's persistent context file.
//
// WHERE THIS SITS IN THE AI-CONTEXT PROGRAM. The unified AI context program
// already established three stores, and this module deliberately adds a fourth
// rather than a parallel mechanism for what those already hold:
//   • firm-wide ASSISTANT instructions  → firm_profile.assistant_instructions
//     (FB-B, api/tenantSettings.ts) — chat + AI email.
//   • per-attorney ASSISTANT instructions → assistant_settings payload
//     (FB-B, api/assistantSettings.ts) — that attorney's chat.
//   • firm EMAIL prompt + house voice   → firm_settings.email_drafting_config
//     (FB-D, api/emailDraftingConfig.ts).
// None of them covers the two capabilities that generate documents — document
// GENERATION and document REVIEW had no firm-level layer at all, which is why
// their universal rules ended up pasted into each service's prompt box. This
// module owns exactly that gap, plus the firm-level persistent context file:
//
//   ai_context_config (ONE json attribute on the firm_settings singleton —
//   Contract K precedent, same discipline as invoice_template_config /
//   manual_payment_methods_config / email_drafting_config):
//     { version, document_generation: {...}, document_review: {...},
//       firm_context_md: string | null }
//
// The USER-level context file is the per-actor twin and lives on that actor's
// existing assistant_settings payload (api/assistantSettings.ts contextMd) —
// again extending the program's store rather than adding one.
//
// Migration 0195 adds the attribute + action kinds. Until it is applied, reads
// degrade safely to the built-in defaults (no attribute row can exist without
// the kind) and a save throws a clear "kind not found" error — the same posture
// 0175 / 0178 / 0180 left their code in.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  DRAFTING_BASE_GUIDANCE,
  REVIEW_BASE_GUIDANCE,
  FIRM_CAPABILITY_INSTRUCTIONS_HEADER,
  FIRM_CONTEXT_HEADER,
  SERVICE_INSTRUCTIONS_HEADER,
  USER_CONTEXT_HEADER,
} from '../templates/promptDefaults.js'

// The capabilities this config covers. Deliberately NOT a list of every AI
// action the platform takes: email drafting and assistant chat already have
// their own firm-level stores (see the header), and the Settings UI links to
// those rather than forking their data.
export const AI_CONTEXT_CAPABILITIES = ['document_generation', 'document_review'] as const
export type AiContextCapability = (typeof AI_CONTEXT_CAPABILITIES)[number]

export function isAiContextCapability(v: unknown): v is AiContextCapability {
  return typeof v === 'string' && (AI_CONTEXT_CAPABILITIES as readonly string[]).includes(v)
}

// Caps. Same shape of discipline as the instruction pills elsewhere in the
// program (500 chars/item, 20 items — handlers/firmProfile.ts), plus a bound on
// the free-form context file so a runaway paste can never dominate a prompt.
export const INSTRUCTION_ITEM_CHAR_CAP = 500
export const INSTRUCTION_MAX_ITEMS = 20
export const CONTEXT_MD_CHAR_CAP = 8000

export interface CapabilityContext {
  // The firm's standing instructions for this capability, one per item.
  instructions: string[]
  // A firm override of the UNIVERSAL base guidance. null = use the built-in
  // rules (the normal case). Exposed because a firm may genuinely need to
  // restate the platform rules in its own words; it is not per-service and is
  // never edited from a service page.
  baseGuidance: string | null
}

export interface AiContextConfigDoc {
  documentGeneration: CapabilityContext
  documentReview: CapabilityContext
  // The firm's persistent context file — the tenant-level analogue of a
  // project-level memory file. Markdown, injected into every AI capability.
  firmContextMd: string | null
  // Bumped whenever anything above actually changes, so the UI can show a
  // version and the audit trail reads as "context at version N".
  version: number
  // True when a stored config row was found at all (vs pure defaults).
  configured: boolean
}

interface StoredCapability {
  instructions?: unknown
  base_guidance?: unknown
}

interface StoredAiContextConfig {
  version?: unknown
  document_generation?: StoredCapability
  document_review?: StoredCapability
  firm_context_md?: unknown
}

// ── normalization (pure) ────────────────────────────────────────────────────

// Instruction pills: trimmed, empties dropped, per-item and count caps applied.
// Tolerant of the legacy single-string shape for the same reason
// assistantPrompt.ts's normalizeInstructionsText is (ITEM-12 WP-2): a value
// written as one blob still reads as one instruction rather than throwing.
export function normalizeInstructionItems(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : []
  return list
    .filter((s): s is string => typeof s === 'string')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.length > INSTRUCTION_ITEM_CHAR_CAP ? s.slice(0, INSTRUCTION_ITEM_CHAR_CAP) : s))
    .slice(0, INSTRUCTION_MAX_ITEMS)
}

// Free-form markdown: trimmed, capped, empty ⇒ null (honest-unset, never '').
export function normalizeContextMd(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  return trimmed.length > CONTEXT_MD_CHAR_CAP ? trimmed.slice(0, CONTEXT_MD_CHAR_CAP) : trimmed
}

function normalizeCapability(raw: StoredCapability | undefined): CapabilityContext {
  return {
    instructions: normalizeInstructionItems(raw?.instructions),
    baseGuidance: normalizeContextMd(raw?.base_guidance),
  }
}

// Pure resolver (exported for tests): stored config → resolved doc. Absent or
// garbage config yields the built-in defaults, never a throw — a firm that has
// never opened this settings page must still generate documents.
export function resolveAiContextConfigDoc(stored: unknown): AiContextConfigDoc {
  const s = (stored && typeof stored === 'object' ? stored : {}) as StoredAiContextConfig
  return {
    documentGeneration: normalizeCapability(s.document_generation),
    documentReview: normalizeCapability(s.document_review),
    firmContextMd: normalizeContextMd(s.firm_context_md),
    version: typeof s.version === 'number' && Number.isFinite(s.version) ? s.version : 0,
    configured: !!stored && typeof stored === 'object',
  }
}

// The base guidance actually in force for a capability: the firm's override
// when set, otherwise the platform default.
export function effectiveBaseGuidance(
  capability: AiContextCapability,
  doc: AiContextConfigDoc,
): string {
  const fallback =
    capability === 'document_generation' ? DRAFTING_BASE_GUIDANCE : REVIEW_BASE_GUIDANCE
  const section = capability === 'document_generation' ? doc.documentGeneration : doc.documentReview
  return section.baseGuidance ?? fallback
}

// ── prompt composition (pure) ───────────────────────────────────────────────

// Render an instruction list as `- item` bullets, matching how the chat's own
// firm/attorney instruction blocks render (assistantPrompt.ts).
function bulletize(items: string[]): string {
  return items.map((i) => `- ${i}`).join('\n')
}

export interface ContextLayers {
  capability: AiContextCapability
  config: AiContextConfigDoc
  // The acting human's own context file, when a specific user is driving the
  // call. Omitted on background/worker generation, where the acting actor is
  // the tenant's AI agent and there is no "current user" to attribute a
  // personal context file to — see composeDraftingBasePrompt's caller notes.
  userContextMd?: string | null
  // The service's own instructions for this document/review, if any.
  serviceInstructions?: string | null
}

// The stacked context blocks, in precedence order: universal rules first (they
// are never overridden), then firm background, then firm defaults for this
// capability, then the user's own file, then the service's instructions —
// narrowest last so the model reads the most specific guidance closest to the
// task. Returns '' when nothing but the base guidance applies is NOT possible:
// the base guidance is always present.
export function composeContextBlocks(layers: ContextLayers): string {
  const parts: string[] = [effectiveBaseGuidance(layers.capability, layers.config)]

  if (layers.config.firmContextMd) {
    parts.push(`${FIRM_CONTEXT_HEADER}\n${layers.config.firmContextMd}`)
  }

  const section =
    layers.capability === 'document_generation'
      ? layers.config.documentGeneration
      : layers.config.documentReview
  if (section.instructions.length > 0) {
    parts.push(`${FIRM_CAPABILITY_INSTRUCTIONS_HEADER}\n${bulletize(section.instructions)}`)
  }

  const userMd = normalizeContextMd(layers.userContextMd)
  if (userMd) {
    parts.push(`${USER_CONTEXT_HEADER}\n${userMd}`)
  }

  const serviceText =
    typeof layers.serviceInstructions === 'string' ? layers.serviceInstructions.trim() : ''
  if (serviceText) {
    parts.push(`${SERVICE_INSTRUCTIONS_HEADER}\n${serviceText}`)
  }

  return parts.join('\n\n')
}

// ── persistence ─────────────────────────────────────────────────────────────

async function readStoredAiContextConfig(ctx: ActionContext): Promise<unknown> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{ value: unknown }>(
      `SELECT a.value
         FROM attribute a
         JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
         JOIN entity e ON e.id = a.entity_id
         JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
        WHERE a.tenant_id = $1
          AND akd.kind_name = 'ai_context_config'
          AND ekd.kind_name = 'firm_settings'
          AND (a.valid_to IS NULL OR a.valid_to > now())
        ORDER BY a.valid_from DESC
        LIMIT 1`,
      [ctx.tenantId],
    )
    return res.rows[0]?.value ?? null
  })
}

// ONE read, whole config resolved. Every generation path calls this; it must
// never throw on an unconfigured firm.
export async function getAiContextConfig(ctx: ActionContext): Promise<AiContextConfigDoc> {
  const stored = await readStoredAiContextConfig(ctx)
  return resolveAiContextConfigDoc(stored)
}

export interface UpdateAiContextConfigInput {
  // undefined → leave unchanged. An array (even empty) replaces the list;
  // null clears it.
  documentGenerationInstructions?: string[] | null
  documentReviewInstructions?: string[] | null
  // undefined → leave unchanged; null/'' → clear back to the platform default.
  documentGenerationBaseGuidance?: string | null
  documentReviewBaseGuidance?: string | null
  // undefined → leave unchanged; null/'' → clear the firm context file.
  firmContextMd?: string | null
  // APPEND semantics for the chat path: add one instruction to a capability's
  // list rather than replacing it, so "also make every document…" never wipes
  // what the attorney already wrote. Applied after the replace fields above.
  appendDocumentGenerationInstruction?: string
  appendDocumentReviewInstruction?: string
  // Append a line to the firm context file (chat path), same reasoning.
  appendFirmContextMd?: string
}

function appendMd(existing: string | null, addition: string | undefined): string | null {
  const add = normalizeContextMd(addition)
  if (!add) return existing
  return normalizeContextMd(existing ? `${existing}\n${add}` : add)
}

// Write the firm's AI context config as a new append-only version (a new
// ai_context_config attribute supersedes the prior one on the firm_settings
// singleton). The version bumps only when something actually changed — same
// discipline as updateEmailDraftingConfig.
export async function updateAiContextConfig(
  ctx: ActionContext,
  input: UpdateAiContextConfigInput,
): Promise<AiContextConfigDoc> {
  const current = resolveAiContextConfigDoc(await readStoredAiContextConfig(ctx))

  let genInstructions = current.documentGeneration.instructions
  if (input.documentGenerationInstructions !== undefined) {
    genInstructions = normalizeInstructionItems(input.documentGenerationInstructions)
  }
  if (input.appendDocumentGenerationInstruction) {
    genInstructions = normalizeInstructionItems([
      ...genInstructions,
      input.appendDocumentGenerationInstruction,
    ])
  }

  let reviewInstructions = current.documentReview.instructions
  if (input.documentReviewInstructions !== undefined) {
    reviewInstructions = normalizeInstructionItems(input.documentReviewInstructions)
  }
  if (input.appendDocumentReviewInstruction) {
    reviewInstructions = normalizeInstructionItems([
      ...reviewInstructions,
      input.appendDocumentReviewInstruction,
    ])
  }

  const genBase =
    input.documentGenerationBaseGuidance !== undefined
      ? normalizeContextMd(input.documentGenerationBaseGuidance)
      : current.documentGeneration.baseGuidance
  const reviewBase =
    input.documentReviewBaseGuidance !== undefined
      ? normalizeContextMd(input.documentReviewBaseGuidance)
      : current.documentReview.baseGuidance

  let firmContextMd =
    input.firmContextMd !== undefined
      ? normalizeContextMd(input.firmContextMd)
      : current.firmContextMd
  firmContextMd = appendMd(firmContextMd, input.appendFirmContextMd)

  const next = {
    document_generation: { instructions: genInstructions, base_guidance: genBase },
    document_review: { instructions: reviewInstructions, base_guidance: reviewBase },
    firm_context_md: firmContextMd,
  }
  const changed =
    JSON.stringify(next) !==
    JSON.stringify({
      document_generation: {
        instructions: current.documentGeneration.instructions,
        base_guidance: current.documentGeneration.baseGuidance,
      },
      document_review: {
        instructions: current.documentReview.instructions,
        base_guidance: current.documentReview.baseGuidance,
      },
      firm_context_md: current.firmContextMd,
    })

  const config = { version: changed ? current.version + 1 : current.version, ...next }

  await submitAction(ctx, {
    actionKindName: 'legal.firm.set_ai_context_config',
    intentKind: 'adjustment',
    payload: { config },
  })

  return resolveAiContextConfigDoc(config)
}
