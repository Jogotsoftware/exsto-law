// Model registry for the unified assistant chat. The attorney picks "any AI
// model you have connected" from a dropdown; this turns the firm's connected
// integrations (Settings → Integrations) into the concrete, selectable models.
//
// A model is SELECTABLE when (a) we have an adapter for its provider and (b) the
// provider integration is connected and healthy. Perplexity models carry web
// citations (research); Claude models are conversational. OpenAI is listed but
// not yet selectable — no chat adapter exists — so it shows as "connect to
// enable" until that lands (then `available` flips to true).
import type { ActionContext } from '@exsto/substrate'
import { listIntegrationStatuses, type IntegrationProvider } from './integrations.js'

export type AssistantProvider = Extract<IntegrationProvider, 'anthropic' | 'perplexity' | 'openai'>

export interface AssistantModel {
  // Stable id the UI sends back on chat: `${provider}:${model}`.
  id: string
  provider: AssistantProvider
  providerLabel: string
  model: string
  label: string
  // We have an adapter for this provider (false = OpenAI, until its adapter lands).
  available: boolean
  // The provider integration is connected and healthy (Settings).
  connected: boolean
  // Perplexity answers carry source citations; Claude answers don't (unless web
  // search is on — see supportsWebSearch).
  supportsCitations: boolean
  // True when this is the recommended default for its provider.
  isDefault: boolean
  // Honours the work-rate knob (effort + adaptive thinking). True on Opus 4.8 /
  // Sonnet 4.6; false on Haiku (rejects `effort`) and non-Claude providers.
  supportsWorkRate: boolean
  // A web-search toggle is meaningful for this model.
  supportsWebSearch: boolean
  // This model ALWAYS searches the web (Perplexity) — the toggle shows locked-on
  // rather than optional.
  webSearchInherent: boolean
}

// Static catalog of the models we expose, per provider. Kept here (not env) so
// the dropdown is stable; the firm default models for drafting/research still
// come from env in the adapters. Labels use the marketing names.
const CATALOG: Array<Omit<AssistantModel, 'connected' | 'id'> & { provider: AssistantProvider }> = [
  // Claude (Anthropic) — conversational assistant. Opus/Sonnet honour the
  // work-rate knob and Claude's web-search tool; Haiku does neither for effort.
  //
  // Auto routes each turn to the cheapest Claude that can do the job (Haiku for
  // ordinary turns, Sonnet for heavy drafting/build turns) — the firm's cost
  // default; an explicit pick pins a model. See chooseAutoModel() below.
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'auto',
    label: 'Auto (picks the right Claude)',
    available: true,
    supportsCitations: false,
    isDefault: true,
    supportsWorkRate: false,
    supportsWebSearch: true,
    webSearchInherent: false,
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    available: true,
    supportsCitations: false,
    isDefault: false,
    supportsWorkRate: true,
    supportsWebSearch: true,
    webSearchInherent: false,
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    available: true,
    supportsCitations: false,
    // Auto (above) is the one anthropic default now; Sonnet is still pinnable.
    isDefault: false,
    supportsWorkRate: true,
    supportsWebSearch: true,
    webSearchInherent: false,
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    available: true,
    supportsCitations: false,
    isDefault: false,
    // Haiku rejects the `effort` parameter, so the work-rate knob is a no-op.
    supportsWorkRate: false,
    supportsWebSearch: true,
    webSearchInherent: false,
  },
  // Perplexity — web research with citations. Always searches the web, so its
  // web-search toggle is shown locked-on.
  {
    provider: 'perplexity',
    providerLabel: 'Perplexity',
    model: 'sonar',
    label: 'Perplexity Sonar (research)',
    available: true,
    supportsCitations: true,
    isDefault: true,
    supportsWorkRate: false,
    supportsWebSearch: true,
    webSearchInherent: true,
  },
  {
    provider: 'perplexity',
    providerLabel: 'Perplexity',
    model: 'sonar-reasoning',
    label: 'Perplexity Sonar Reasoning',
    available: true,
    supportsCitations: true,
    isDefault: false,
    supportsWorkRate: false,
    supportsWebSearch: true,
    webSearchInherent: true,
  },
  // OpenAI — listed for visibility; no chat adapter yet (available: false).
  {
    provider: 'openai',
    providerLabel: 'OpenAI',
    model: 'gpt-4o',
    label: 'OpenAI GPT-4o (coming soon)',
    available: false,
    supportsCitations: false,
    isDefault: true,
    supportsWorkRate: false,
    supportsWebSearch: false,
    webSearchInherent: false,
  },
]

function modelId(provider: AssistantProvider, model: string): string {
  return `${provider}:${model}`
}

// Stable id for the "Auto" tier — the UI sends this back like any other pick,
// and the chat handler resolves it (via chooseAutoModel, below) to one of the
// two concrete ids it can hand back, instead of pinning a single model.
export const AUTO_MODEL_ID = 'anthropic:auto'

// The two concrete Anthropic models chooseAutoModel() picks between. These
// values must stay equal to the `model` fields on the Haiku/Sonnet CATALOG
// entries above — Auto only ever hands back a model this file already exposes,
// never an invented id.
export const AUTO_MODEL_HAIKU_ID = 'claude-haiku-4-5-20251001'
export const AUTO_MODEL_SONNET_ID = 'claude-sonnet-4-6'

// Intent verbs that signal real drafting/analysis work. Matched as a token
// PREFIX (not exact-equal) so inflected forms count too — "reviewing",
// "drafted", "analyzing" — without a bare \b regex, which mis-splits right at
// an accented letter (this repo hit that bug before: ASCII \b vs Ñ). Deliberately
// excludes "summarize" — a long summary is still a cheap turn.
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
// letter"), not \w/\b — a plain ASCII word boundary can fall in the wrong place
// right next to an accented character, splitting a word incorrectly. This keeps
// each token a clean run of letters in any language, e.g. "Ñ" stays attached to
// its word instead of acting as a boundary.
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

// The catalog cross-referenced with the firm's live integration health. Order:
// connected+available models first (so the dropdown's first entry is usable),
// then the rest.
export async function listAssistantModels(ctx: ActionContext): Promise<AssistantModel[]> {
  const statuses = await listIntegrationStatuses(ctx)
  const healthy = new Set(
    statuses.filter((s) => s.connected && s.health === 'connected').map((s) => s.provider),
  )
  const models = CATALOG.map((m) => ({
    ...m,
    id: modelId(m.provider, m.model),
    connected: healthy.has(m.provider),
  }))
  const rank = (m: AssistantModel) => (m.available && m.connected ? 0 : m.available ? 1 : 2)
  return models.sort((a, b) => rank(a) - rank(b))
}

// Resolve a model id the UI sent back to a catalog entry, validating it is one
// we actually expose. Returns null for an unknown id.
export function resolveAssistantModel(id: string): AssistantModel | null {
  const [provider, ...rest] = id.split(':')
  const model = rest.join(':')
  const entry = CATALOG.find((m) => m.provider === provider && m.model === model)
  if (!entry) return null
  return { ...entry, id: modelId(entry.provider, entry.model), connected: false }
}
