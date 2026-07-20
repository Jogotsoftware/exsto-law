// AI-CONTEXT C1 — the central model router: ONE place that decides which
// Claude (or Perplexity, for research) model an AI task runs on. Before this
// file, "which model" was answered THREE different ways, and two of them were
// wrong:
//   1. adapters/claude.ts's `DEFAULT_MODEL = process.env.LEGAL_DRAFTING_MODEL
//      ?? 'claude-sonnet-4-6'` — every server drafting call (draft, review,
//      redline, email, transcript extraction, briefs, config-regenerate).
//      BUG: `??` only catches null/undefined, not `''`. A real deploy state
//      (LEGAL_DRAFTING_MODEL set to the empty string, not unset — see
//      clientAssistantChat.ts's old workaround comment) silently sent '' as
//      the model id to the Anthropic API.
//   2. api/assistantModels.ts's CATALOG + chooseAutoModel() — the unified
//      attorney/client chat's model picker, including the "Auto" cost tier
//      (Haiku for ordinary turns, Sonnet for heavy drafting/build turns).
//   3. Ad hoc pins scattered in callers — clientAssistantChat.ts hardcoded
//      'claude-sonnet-4-6' (a deliberate workaround for bug #1), and
//      standaloneTemplates.ts read `resolveAssistantModel(id)?.model` WITHOUT
//      resolving Auto first, so picking Auto sent the literal string 'auto'
//      to the API (a second real bug).
//
// This file is PURE POLICY: no `@anthropic-ai/sdk` import, no network I/O.
// `adapters/claude.ts` stays the ONLY place that actually calls the Anthropic
// API (the vertical's single-adapter rule — CLAUDE.md, exsto-ai-operation
// skill). Every other file that used to guess a model now asks this file.
//
// Module-boundary note: this file imports `resolveAssistantModel` (a hoisted
// function declaration) from api/assistantModels.ts for
// resolveConcreteAssistantModelId, and assistantModels.ts re-exports this
// file's AUTO_MODEL_* / chooseAutoModel for backward compatibility — a real
// import cycle. It is safe ONLY because (a) the cross-import is used inside a
// function body here, never at this module's own top level, and (b)
// assistantModels.ts forwards those symbols via a bare `export { ... } from`
// re-export (which aliases a binding without dereferencing it) rather than
// computing a new top-level const from them. Do not "simplify" either side
// into a top-level `const x = importedValue` — in this cycle that is a
// TDZ crash waiting for the wrong module-load order (see PR description).

import { resolveAssistantModel } from '../api/assistantModels.js'

export type AiTask =
  | 'chat_turn'
  | 'chat_client_portal'
  | 'draft_generate'
  | 'draft_revise'
  | 'doc_review'
  | 'redline'
  | 'email_generate'
  | 'transcript_extract'
  | 'brief_matter'
  | 'brief_client'
  | 'service_digest'
  | 'config_regenerate'
  | 'template_ai'
  | 'key_verify'
  | 'research'

export type ModelTier = 'haiku' | 'sonnet' | 'opus'

// THE single home of Claude model ids. Every other file (claude.ts,
// assistantModels.ts's CATALOG, perplexity.ts, tests, …) either imports this
// or is covered by a test that cross-checks it — never re-hardcode an id.
export const TIER_MODEL: Record<ModelTier, string> = {
  haiku: 'claude-haiku-4-5-20251001',
  sonnet: 'claude-sonnet-4-6',
  opus: 'claude-opus-4-8',
}

const DEFAULT_RESEARCH_MODEL = 'sonar'

export interface RouteSignals {
  // A model id the CALLER already resolved (e.g. the attorney's explicit pick
  // from the chat dropdown, already run through resolveConcreteAssistantModelId
  // so 'auto' never reaches here). Wins over everything else when present.
  explicitModel?: string
  // Size of the input this task is about to process (prompt length, transcript
  // length, …) — drives the haiku→sonnet escalation for a couple of tasks.
  inputChars?: number
  // Per-service model override. Plumbed for a future "this service always
  // drafts on Opus" config knob; always undefined today — no caller sets it.
  serviceOverride?: string
  // Whether this turn is in the attorney build wizard (heavier turns). Only
  // meaningful for chat_turn's upstream Auto resolution (chooseAutoModel);
  // kept on RouteSignals for a uniform call shape, not consumed below.
  buildMode?: boolean
}

export interface ResolvedModel {
  model: string
  tier: ModelTier
  // Whether this model honours the work-rate knob (effort + adaptive
  // thinking) — Opus/Sonnet do, Haiku rejects `effort`. False for the
  // research task (Perplexity, a different provider entirely).
  supportsWorkRate: boolean
  // Human-readable trail for logs: which precedence step decided the model,
  // and why (e.g. "transcript_extract: escalated — inputChars > 300,000").
  reason: string
}

// Normalize an env var that might be undefined OR the empty string — a real
// deploy state, not a hypothetical (see the module header). `??` only catches
// null/undefined; `?.trim() || undefined` is the actual fix.
function normalizeEnvModel(raw: string | undefined): string | undefined {
  return raw?.trim() || undefined
}

// Tasks whose server-side drafting the firm-wide LEGAL_DRAFTING_MODEL env
// override applies to. Deliberately excludes chat_turn/chat_client_portal
// (chat has its own model selection — the catalog + Auto tier) and
// key_verify/research (a connectivity probe and Perplexity research are not
// "drafting").
const DRAFTING_MODEL_TASKS: ReadonlySet<AiTask> = new Set<AiTask>([
  'draft_generate',
  'draft_revise',
  'doc_review',
  'redline',
  'email_generate',
  'transcript_extract',
  'brief_matter',
  'brief_client',
  'service_digest',
  'config_regenerate',
  'template_ai',
])

function tierResult(tier: ModelTier, reason: string): ResolvedModel {
  return { model: TIER_MODEL[tier], tier, supportsWorkRate: tier !== 'haiku', reason }
}

// Best-effort tier classification for an arbitrary model id string (used when
// the model came from an explicit override rather than TIER_MODEL directly,
// so ResolvedModel.tier/supportsWorkRate stay meaningful). Defaults to
// 'sonnet' — the conservative choice (work-rate support assumed on) for an id
// this router doesn't recognize.
function tierForModel(model: string): ModelTier {
  if (model.includes('haiku')) return 'haiku'
  if (model.includes('opus')) return 'opus'
  return 'sonnet'
}

// Per-task registry default (before any escalation) — precedence step 4.
function registryDefault(task: AiTask, signals: RouteSignals): ResolvedModel {
  switch (task) {
    case 'key_verify':
      return tierResult('haiku', 'key_verify: always haiku (cheapest connectivity probe)')
    case 'transcript_extract':
      return (signals.inputChars ?? 0) > 300_000
        ? tierResult('sonnet', 'transcript_extract: escalated — inputChars > 300,000')
        : tierResult('haiku', 'transcript_extract: default haiku')
    case 'service_digest':
      return (signals.inputChars ?? 0) > 100_000
        ? tierResult('sonnet', 'service_digest: escalated — inputChars > 100,000')
        : tierResult('haiku', 'service_digest: default haiku')
    case 'chat_client_portal':
      return tierResult('sonnet', 'chat_client_portal: pinned sonnet')
    case 'chat_turn':
      // The unified attorney chat resolves 'auto' upstream (assistantModels'
      // chooseAutoModel, via resolveConcreteAssistantModelId) and passes the
      // concrete id back in as signals.explicitModel — this default only
      // covers a caller that never sets one (e.g. the legacy askAssistant
      // path), and matches the OLD DEFAULT_MODEL fallback value exactly.
      return tierResult('sonnet', 'chat_turn: default sonnet (no explicit/Auto-resolved model)')
    default:
      return tierResult('sonnet', `${task}: default sonnet (server drafting task)`)
  }
}

function resolveResearchModel(signals: RouteSignals): ResolvedModel {
  const explicit = normalizeEnvModel(signals.explicitModel)
  if (explicit) {
    return {
      model: explicit,
      tier: 'sonnet',
      supportsWorkRate: false,
      reason: 'research: explicit model override',
    }
  }
  const envModel = normalizeEnvModel(process.env.LEGAL_RESEARCH_MODEL)
  if (envModel) {
    return {
      model: envModel,
      tier: 'sonnet',
      supportsWorkRate: false,
      reason: 'research: LEGAL_RESEARCH_MODEL override (normalized)',
    }
  }
  return {
    model: DEFAULT_RESEARCH_MODEL,
    tier: 'sonnet',
    supportsWorkRate: false,
    reason: 'research: default sonar',
  }
}

// Resolve the model for one AI task. Precedence:
//   1. an explicit, validated model id (signals.explicitModel) wins outright
//   2. a service-level override (signals.serviceOverride) — plumbed for a
//      future per-service config knob; always undefined today
//   3. the firm-wide LEGAL_DRAFTING_MODEL env override — ONLY for server
//      drafting tasks (see DRAFTING_MODEL_TASKS), never chat/key_verify
//   4. the per-task registry default, with escalation where the table calls
//      for it (transcript_extract / service_digest by inputChars)
//
// 'research' is handled separately (a different provider, Perplexity, whose
// model ids don't map onto TIER_MODEL's haiku/sonnet/opus tiers) but still
// goes through this one entry point so LEGAL_RESEARCH_MODEL is normalized in
// exactly one place too.
export function resolveModelForTask(task: AiTask, signals: RouteSignals = {}): ResolvedModel {
  if (task === 'research') return resolveResearchModel(signals)

  const explicit = normalizeEnvModel(signals.explicitModel)
  if (explicit) {
    const tier = tierForModel(explicit)
    return {
      model: explicit,
      tier,
      supportsWorkRate: tier !== 'haiku',
      reason: `${task}: explicit model override`,
    }
  }

  if (signals.serviceOverride) {
    const tier = tierForModel(signals.serviceOverride)
    return {
      model: signals.serviceOverride,
      tier,
      supportsWorkRate: tier !== 'haiku',
      reason: `${task}: service-level override`,
    }
  }

  if (DRAFTING_MODEL_TASKS.has(task)) {
    const override = normalizeEnvModel(process.env.LEGAL_DRAFTING_MODEL)
    if (override) {
      const tier = tierForModel(override)
      return {
        model: override,
        tier,
        supportsWorkRate: tier !== 'haiku',
        reason: `${task}: LEGAL_DRAFTING_MODEL override (normalized)`,
      }
    }
  }

  return registryDefault(task, signals)
}

// ── Auto tier resolution (moved from assistantModels.ts) ────────────────────
// Pure routing policy — kept here so resolveConcreteAssistantModelId can call
// it directly without a cross-module cycle. assistantModels.ts re-exports
// these for backward compatibility (existing imports of chooseAutoModel /
// AUTO_MODEL_* from '@exsto/legal' or './assistantModels.js' keep working).

// Stable id for the "Auto" tier — the UI sends this back like any other pick;
// resolveConcreteAssistantModelId resolves it (via chooseAutoModel) to one of
// the two concrete ids below, instead of pinning a single model.
export const AUTO_MODEL_ID = 'anthropic:auto'

// The two concrete Anthropic models chooseAutoModel() picks between. These
// MUST stay equal to the Haiku/Sonnet TIER_MODEL entries — Auto only ever
// hands back a model TIER_MODEL already names, never an invented id.
export const AUTO_MODEL_HAIKU_ID = TIER_MODEL.haiku
export const AUTO_MODEL_SONNET_ID = TIER_MODEL.sonnet

// Intent verbs that signal real drafting/analysis work. Matched as a token
// PREFIX (not exact-equal) so inflected forms count too — "reviewing",
// "drafted", "analyzing" — without a bare \b regex, which mis-splits right at
// an accented letter (this repo hit that bug before). Deliberately excludes
// "summarize" — a long summary is still a cheap turn.
const HEAVY_INTENT_VERBS: readonly string[] = [
  'draft',
  'write',
  'compose',
  'prepare',
  'revise',
  'redline',
  'analyze',
  'review',
]

// Document-ish nouns that make a request about a real filing/instrument rather
// than a quick question. Exact token match (no inflection) — plurals aren't
// worth the false-positive risk a prefix match would add here.
const HEAVY_DOCUMENT_NOUNS = new Set([
  'letter',
  'email',
  'agreement',
  'contract',
  'motion',
  'brief',
  'memo',
  'clause',
  'addendum',
  'amendment',
  'lease',
  'will',
  'deed',
  'complaint',
  'petition',
  'envelope',
])

// Lower-cases and splits on runs of non-letters using \p{L} (Unicode "is a
// letter"), not \w/\b — a plain ASCII word boundary can fall in the wrong
// place right next to an accented character, splitting a word incorrectly.
// This keeps each token a clean run of letters in any language, e.g. "Ñ"
// stays attached to its word instead of acting as a boundary.
function tokenize(message: string): string[] {
  return message
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((token) => token.length > 0)
}

// True when the tokens show a drafting/analysis ask against a real document:
// an intent-verb (or its "draw up" phrasal form) alongside a document noun.
function hasHeavyIntent(tokens: string[]): boolean {
  const hasDocNoun = tokens.some((t) => HEAVY_DOCUMENT_NOUNS.has(t))
  if (!hasDocNoun) return false
  if (tokens.some((t) => HEAVY_INTENT_VERBS.some((verb) => t.startsWith(verb)))) return true
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i] === 'draw' && tokens[i + 1] === 'up') return true
  }
  return false
}

// Cost-default router for the "Auto" tier: ordinary turns go to Haiku, and we
// escalate to Sonnet only when the turn shows it actually needs it — an
// explicit build-mode turn, a genuine drafting/analysis ask against a real
// document, or enough text (this message or the accumulated history) that a
// stronger model earns its cost. Pure and deterministic (no I/O, no Date, no
// randomness) so every branch is directly testable.
export function chooseAutoModel(input: {
  message: string
  buildMode?: boolean
  historyChars?: number
}): string {
  const heavy =
    input.buildMode === true ||
    input.message.length > 1500 ||
    (input.historyChars ?? 0) > 60000 ||
    hasHeavyIntent(tokenize(input.message))
  return heavy ? AUTO_MODEL_SONNET_ID : AUTO_MODEL_HAIKU_ID
}

// Wraps resolveAssistantModel + chooseAutoModel so 'auto' / 'anthropic:auto'
// ALWAYS resolves to a concrete model id before it can reach the adapter.
// Fixes the standaloneTemplates.ts bug where picking Auto sent the literal
// string 'auto' to the Anthropic API (resolveAssistantModel(id)?.model
// returned CATALOG's 'auto' placeholder unresolved). Returns null for an
// unknown/missing model id — the caller decides the fallback (usually the
// task's registry default via resolveModelForTask).
export function resolveConcreteAssistantModelId(
  modelId: string,
  auto: { message: string; buildMode?: boolean; historyChars?: number },
): string | null {
  // Bare 'auto' is handled explicitly — the catalog only has an entry for the
  // compound id (AUTO_MODEL_ID = 'anthropic:auto'), so resolveAssistantModel
  // would return null for the unprefixed form and this fallback would
  // otherwise be skipped, defeating "'auto' always resolves".
  if (modelId === 'auto' || modelId === AUTO_MODEL_ID) {
    return chooseAutoModel(auto)
  }
  const model = resolveAssistantModel(modelId)
  if (!model) return null
  if (model.provider === 'anthropic' && model.model === 'auto') {
    return chooseAutoModel(auto)
  }
  return model.model
}
