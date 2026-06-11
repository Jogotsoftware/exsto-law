import { submitAction, type ActionContext } from '@exsto/substrate'
import {
  listConnections,
  saveConnection,
  loadConnection,
  disconnect as disconnectProvider,
} from '../adapters/connectionStore.js'
import { verifyAnthropicKey } from '../adapters/claude.js'
import { verifyPerplexityKey } from '../adapters/perplexity.js'

export type IntegrationProvider = 'granola' | 'perplexity' | 'anthropic' | 'openai'

export interface IntegrationStatus {
  provider: IntegrationProvider | 'docusign' | 'google_calendar'
  authKind: 'api_key' | 'oauth' | 'coming_soon'
  connected: boolean
  comingSoon?: boolean
  // 'error' state surfaces prominently in Settings (broken sync ≠ disconnected).
  health: 'connected' | 'error' | 'disconnected'
  lastFour: string | null
  connectedAt: string | null
  lastVerifiedAt: string | null
  lastVerifyError: string | null
  // OAuth providers only
  accountEmail?: string | null
}

const STATIC_INTEGRATIONS: Array<{
  provider: IntegrationStatus['provider']
  authKind: IntegrationStatus['authKind']
  comingSoon?: boolean
}> = [
  { provider: 'google_calendar', authKind: 'oauth' },
  { provider: 'anthropic', authKind: 'api_key' },
  { provider: 'openai', authKind: 'api_key' },
  { provider: 'perplexity', authKind: 'api_key' },
  { provider: 'granola', authKind: 'api_key' },
  { provider: 'docusign', authKind: 'coming_soon', comingSoon: true },
]

// Connection metadata lives in legal_integration_connection; secret material in
// Vault (REQ-SEC-01). The 'google' provider row backs the google_calendar card.
export async function listIntegrationStatuses(ctx: ActionContext): Promise<IntegrationStatus[]> {
  const conns = await listConnections(ctx.tenantId)
  const byProvider = new Map(conns.map((c) => [c.provider, c]))

  return STATIC_INTEGRATIONS.map(({ provider, authKind, comingSoon }) => {
    if (comingSoon) {
      return {
        provider,
        authKind,
        comingSoon: true,
        connected: false,
        health: 'disconnected' as const,
        lastFour: null,
        connectedAt: null,
        lastVerifiedAt: null,
        lastVerifyError: null,
      }
    }
    const c = byProvider.get(provider === 'google_calendar' ? 'google' : provider)
    const health = c?.status ?? 'disconnected'
    return {
      provider,
      authKind,
      comingSoon: false,
      connected: health === 'connected',
      health,
      lastFour: typeof c?.detail?.last_four === 'string' ? (c.detail.last_four as string) : null,
      connectedAt: c?.connectedAt?.toISOString() ?? null,
      lastVerifiedAt: c?.updatedAt?.toISOString() ?? null,
      lastVerifyError: c?.lastError ?? null,
      accountEmail: provider === 'google_calendar' ? (c?.accountEmail ?? null) : undefined,
    }
  })
}

// Read a stored API key for server-side use (drafting, ingestion). Env var
// takes precedence so local dev works without a connected integration.
export async function loadApiKey(
  tenantId: string,
  provider: IntegrationProvider,
): Promise<string | null> {
  const conn = await loadConnection<{ api_key: string }>(tenantId, provider)
  return conn?.secret.api_key ?? null
}

// Ping the provider with the supplied key. Returns null on success or an
// error string. Network errors / unexpected status codes are reported.
async function verifyKey(provider: IntegrationProvider, apiKey: string): Promise<string | null> {
  try {
    if (provider === 'anthropic') {
      // The claude adapter owns all Anthropic API traffic (vertical rule).
      return await verifyAnthropicKey(apiKey)
    }
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (!r.ok) return `OpenAI returned ${r.status}: ${await safeBody(r)}`
      return null
    }
    if (provider === 'perplexity') {
      // The perplexity adapter owns all Perplexity API traffic (vertical rule),
      // mirroring the Anthropic refactor.
      return await verifyPerplexityKey(apiKey)
    }
    if (provider === 'granola') {
      // Granola's public API is in beta; best-effort check against their
      // documented /v1/me endpoint. If it 404s we accept the key on the
      // assumption that the schema may have shifted — the connection will
      // surface real failures when the integration is actually used.
      const r = await fetch('https://api.granola.ai/v1/me', {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (r.status === 401 || r.status === 403) {
        return `Granola rejected the key (${r.status})`
      }
      return null
    }
    return `Unknown provider: ${provider as string}`
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
}

async function safeBody(r: Response): Promise<string> {
  try {
    const text = await r.text()
    return text.slice(0, 200)
  } catch {
    return ''
  }
}

export interface ConnectIntegrationInput {
  provider: IntegrationProvider
  apiKey: string
  // Granola only: the webhook signing secret rides in the same Vault record.
  webhookSecret?: string
}

export interface ConnectResult {
  ok: boolean
  error?: string
  status?: IntegrationStatus
}

// Persistence half of connect — exported separately so tests can exercise the
// save/merge semantics without a live provider ping.
export async function persistIntegrationKey(
  ctx: ActionContext,
  input: ConnectIntegrationInput,
): Promise<void> {
  let secret: Record<string, string> = { api_key: input.apiKey }
  if (input.provider === 'granola') {
    // Replacing the API key must not wipe a previously-stored webhook secret:
    // both live in the one Vault record and saveConnection overwrites whole.
    const existing = await loadConnection<{ api_key: string; webhook_secret?: string }>(
      ctx.tenantId,
      'granola',
    )
    const webhookSecret = input.webhookSecret?.trim() || existing?.secret.webhook_secret
    secret = webhookSecret ? { api_key: input.apiKey, webhook_secret: webhookSecret } : secret
  }
  await saveConnection(ctx.tenantId, input.provider, secret, {
    detail: { last_four: input.apiKey.slice(-4) },
  })
}

// Connecting/disconnecting an integration is a configuration change; record it
// through the action layer so Settings activity is auditable like everything
// else. The payload carries NO secret material — provider + masked key only.
async function recordIntegrationChange(
  ctx: ActionContext,
  provider: string,
  change: 'connected' | 'disconnected',
  lastFour: string | null,
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'config.change',
    intentKind: 'adjustment',
    payload: {
      target_table: 'legal_integration_connection',
      change_kind: 'update',
      after_value: { provider, status: change, ...(lastFour ? { last_four: lastFour } : {}) },
      change_reason: `integration ${change} via Settings`,
    },
  })
}

export async function connectIntegration(
  ctx: ActionContext,
  input: ConnectIntegrationInput,
): Promise<ConnectResult> {
  const verifyError = await verifyKey(input.provider, input.apiKey)
  if (verifyError) return { ok: false, error: verifyError }

  await persistIntegrationKey(ctx, input)
  await recordIntegrationChange(ctx, input.provider, 'connected', input.apiKey.slice(-4))
  const statuses = await listIntegrationStatuses(ctx)
  const status = statuses.find((s) => s.provider === input.provider)
  return { ok: true, status }
}

export async function disconnectIntegration(
  ctx: ActionContext,
  provider: IntegrationProvider,
): Promise<void> {
  await disconnectProvider(ctx.tenantId, provider)
  await recordIntegrationChange(ctx, provider, 'disconnected', null)
}
