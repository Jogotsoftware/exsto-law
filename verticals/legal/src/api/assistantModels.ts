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
  // Perplexity answers carry source citations; Claude answers don't.
  supportsCitations: boolean
  // True when this is the recommended default for its provider.
  isDefault: boolean
}

// Static catalog of the models we expose, per provider. Kept here (not env) so
// the dropdown is stable; the firm default models for drafting/research still
// come from env in the adapters. Labels use the marketing names.
const CATALOG: Array<Omit<AssistantModel, 'connected' | 'id'> & { provider: AssistantProvider }> = [
  // Claude (Anthropic) — conversational assistant.
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    available: true,
    supportsCitations: false,
    isDefault: false,
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    available: true,
    supportsCitations: false,
    isDefault: true,
  },
  {
    provider: 'anthropic',
    providerLabel: 'Claude',
    model: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5',
    available: true,
    supportsCitations: false,
    isDefault: false,
  },
  // Perplexity — web research with citations.
  {
    provider: 'perplexity',
    providerLabel: 'Perplexity',
    model: 'sonar',
    label: 'Perplexity Sonar (research)',
    available: true,
    supportsCitations: true,
    isDefault: true,
  },
  {
    provider: 'perplexity',
    providerLabel: 'Perplexity',
    model: 'sonar-reasoning',
    label: 'Perplexity Sonar Reasoning',
    available: true,
    supportsCitations: true,
    isDefault: false,
  },
  // OpenAI — listed for visibility; no chat adapter yet (available: false).
  {
    provider: 'openai',
    providerLabel: 'OpenAI',
    model: 'gpt-4o',
    label: 'OpenAI GPT-4o (connect to enable)',
    available: false,
    supportsCitations: false,
    isDefault: true,
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

// The default model id to preselect when the UI has no prior choice: the first
// connected+available model, else the catalog default for the first available
// provider. Pure given the model list, so the UI can call it on the client.
export function defaultModelId(models: AssistantModel[]): string | null {
  const usable = models.find((m) => m.available && m.connected)
  if (usable) return usable.id
  const fallback = models.find((m) => m.available && m.isDefault) ?? models.find((m) => m.available)
  return fallback?.id ?? null
}
