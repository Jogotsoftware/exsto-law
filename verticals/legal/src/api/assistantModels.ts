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
// AI-CONTEXT C1 — chooseAutoModel + the AUTO_MODEL_* ids now live in the
// central model router (lib/modelRouter.ts); re-exported here (a bare
// `export … from`, not a computed value) so every existing import of these
// symbols from this module — or from '@exsto/legal' — keeps working. This is
// a genuine import cycle (modelRouter.ts imports resolveAssistantModel below
// for resolveConcreteAssistantModelId) that is safe ONLY as a pure re-export;
// see modelRouter.ts's module header before changing either side.
export {
  AUTO_MODEL_ID,
  AUTO_MODEL_HAIKU_ID,
  AUTO_MODEL_SONNET_ID,
  chooseAutoModel,
} from '../lib/modelRouter.js'

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
