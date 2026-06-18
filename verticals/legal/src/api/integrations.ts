import { submitAction, type ActionContext } from '@exsto/substrate'
import {
  listConnections,
  saveConnection,
  loadConnection,
  disconnect as disconnectProvider,
} from '../adapters/connectionStore.js'
import { verifyAnthropicKey } from '../adapters/claude.js'
import { verifyPerplexityKey } from '../adapters/perplexity.js'

// Granola is NOT here: it moved off api-key to per-attorney OAuth/MCP (WP1.2),
// so it is an oauth provider (like google), connected via its own flow — never
// through the api-key connect path below.
export type IntegrationProvider = 'perplexity' | 'anthropic' | 'openai'

export interface IntegrationStatus {
  provider: IntegrationProvider | 'docusign' | 'google_calendar' | 'granola'
  authKind: 'api_key' | 'oauth' | 'coming_soon'
  connected: boolean
  comingSoon?: boolean
  // 'error' state surfaces prominently in Settings (broken sync ≠ disconnected).
  health: 'connected' | 'error' | 'disconnected'
  lastFour: string | null
  connectedAt: string | null
  lastVerifiedAt: string | null
  lastVerifyError: string | null
  // When the last capability probe ran (connect or refresh). Drives the
  // "Last checked …" line in the panel (WP1.5). Null if never probed.
  lastProbeAt: string | null
  // OAuth providers only
  accountEmail?: string | null
}

const STATIC_INTEGRATIONS: Array<{
  provider: IntegrationStatus['provider']
  authKind: IntegrationStatus['authKind']
  comingSoon?: boolean
}> = [
  { provider: 'google_calendar', authKind: 'oauth' },
  { provider: 'granola', authKind: 'oauth' },
  { provider: 'anthropic', authKind: 'api_key' },
  { provider: 'openai', authKind: 'api_key' },
  { provider: 'perplexity', authKind: 'api_key' },
  { provider: 'docusign', authKind: 'coming_soon', comingSoon: true },
]

// Connection metadata lives in legal_integration_connection; secret material in
// Vault (REQ-SEC-01). The 'google' provider row backs the google_calendar card.
export async function listIntegrationStatuses(ctx: ActionContext): Promise<IntegrationStatus[]> {
  // The attorney's own personal connections (google/granola) + the firm-wide AI
  // keys (actor_id NULL). listConnections returns both for this actor.
  const conns = await listConnections(ctx.tenantId, ctx.actorId)
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
        lastProbeAt: null,
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
      lastProbeAt:
        typeof c?.detail?.last_probe_at === 'string' ? (c.detail.last_probe_at as string) : null,
      accountEmail:
        provider === 'google_calendar' || provider === 'granola'
          ? (c?.accountEmail ?? null)
          : undefined,
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
  // Firm-wide AI keys only (anthropic/openai/perplexity) — granola is OAuth now.
  const secret: Record<string, string> = { api_key: input.apiKey }
  await saveConnection(
    ctx.tenantId,
    input.provider,
    secret,
    { detail: { last_four: input.apiKey.slice(-4) } },
    ctx.actorId,
  )
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

// Record a capability-probe result through the core (legal.integration.probe,
// migration 0027). The handler performs the connection status write atomically:
// 'connected' stamps last_probe_at on the just-stored row; 'error' upserts an
// 'error' row with the (already-redacted) detail. NO secret material in payload.
// Callers treat this as best-effort audit/stamp where the connect outcome is
// already decided — a missing kind (pre-0027 env) or transient failure must not
// break a connect that otherwise succeeded.
export async function recordIntegrationProbe(
  ctx: ActionContext,
  provider: string,
  outcome: 'connected' | 'error',
  detail: string | null,
  accountEmail?: string | null,
): Promise<void> {
  await submitAction(ctx, {
    actionKindName: 'legal.integration.probe',
    intentKind: 'automatic_sync',
    payload: {
      provider,
      outcome,
      detail: detail ?? null,
      accountEmail: accountEmail ?? null,
      actorId: ctx.actorId ?? null,
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
  // verifyKey above WAS a live provider probe — record it through the core so
  // last_probe_at is stamped and the panel's "Last checked" shows. Best-effort:
  // a missing kind (pre-0027 env) or transient failure must not fail the connect.
  await recordIntegrationProbe(ctx, input.provider, 'connected', null).catch((e) =>
    console.error('[integrations] probe audit failed (non-fatal):', e),
  )
  const statuses = await listIntegrationStatuses(ctx)
  const status = statuses.find((s) => s.provider === input.provider)
  return { ok: true, status }
}

export async function disconnectIntegration(
  ctx: ActionContext,
  provider: IntegrationProvider,
): Promise<void> {
  await disconnectProvider(ctx.tenantId, provider, ctx.actorId)
  await recordIntegrationChange(ctx, provider, 'disconnected', null)
}
