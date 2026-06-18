// ─────────────────────────────────────────────────────────────────────────────
// CONTRACT A — provider credentials & connection status (the integration spine).
//
// FROZEN public surface. Sibling sessions (comms, e-sign) import these two
// functions; their signatures do not change. Two deliberate shapes:
//
//   getProviderCredential(ctx, provider) → live secret material from Vault, or
//     null when there is nothing usable (disconnected / never connected). Reads
//     Supabase Vault ONLY — never an env var, never a plaintext column. Callers
//     that want the platform-default env fallback (the drafting/research worker)
//     use the adapters' resolve* helpers instead; Contract A is the firm's
//     attorney-owned credential, nothing else.
//
//   getConnectionStatus(ctx, provider) → { status, detail? }. `status` is
//     'connected' ONLY after a real capability probe passed at connect time
//     (Google: dual Gmail+Calendar probe; API keys: a live provider ping). The
//     probe gate is enforced in the WRITE path (the Google exchange + the
//     legal.integration.probe handler), so this read faithfully reports a
//     probe-verified state — a token that was merely *received* never reads as
//     connected.
//
// Why thread ActionContext instead of the brief's bare (provider): this repo is
// strictly tenant- and per-attorney-scoped (CLAUDE.md hard rule 2 — every query
// carries tenancy; migration 0016 — google/granola are per-attorney). A bare
// (provider) lookup has no tenant to scope to and no attorney to resolve. ctx
// carries both (ctx.tenantId, ctx.actorId), matching every other function in
// this vertical. This is the only tenancy-safe signature.
// ─────────────────────────────────────────────────────────────────────────────
import type { ActionContext } from '@exsto/substrate'
import { getConnectionInfo, loadConnection, type ConnectionStatus } from './connectionStore.js'

// The four providers the spine serves. Distinct from api/integrations.ts's
// `IntegrationProvider` (the API-key set: anthropic/openai/perplexity/granola,
// no google) — this set is google/granola/anthropic/perplexity, no openai.
export type CredentialProvider = 'google' | 'granola' | 'anthropic' | 'perplexity'

// Each credential carries its `provider` tag so ProviderCredential is a proper
// discriminated union (callers using the generic overload can switch on it).

// Google: one connection grants calendar + Gmail. Tokens are what a downstream
// Gmail/Calendar client (comms session) builds an authed client from.
export interface GoogleCredential {
  provider: 'google'
  accountEmail: string | null
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
  scope: string
  calendarId: string
}

// Firm-wide AI keys.
export interface ApiKeyCredential {
  provider: 'anthropic' | 'perplexity'
  apiKey: string
}

// Granola: the OAuth/MCP bearer (WP1.2 retired the api-key path). The downstream
// MCP client (granolaMcp) handles token refresh; consumers usually just need to
// know it's connected via getConnectionStatus.
export interface GranolaCredential {
  provider: 'granola'
  accessToken: string
  refreshToken: string
  expiresAt: string // ISO
  scope?: string | null
}

export type ProviderCredential = GoogleCredential | ApiKeyCredential | GranolaCredential

export interface ConnectionStatusResult {
  status: ConnectionStatus // 'connected' | 'error' | 'disconnected'
  // Human-readable reason when not connected (last probe / refresh failure).
  // Populated from last_error; never contains secret material (redacted at write).
  detail?: string
  // When the last capability probe ran (connect or refresh). Null if never probed.
  lastProbeAt: string | null
  accountEmail: string | null
}

// Internal stored-secret shapes (mirror what each connect path writes to Vault).
type GoogleSecret = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  scope: string
  calendarId: string
}
type ApiKeySecret = { api_key: string }
type GranolaSecret = {
  accessToken: string
  refreshToken: string
  expiresAt: string
  clientId: string
  scope?: string | null
  webhook_secret?: string
}

// ── getProviderCredential — Vault-only live credential read ───────────────────
// Overloads give siblings a provider-typed result without a cast.
export function getProviderCredential(
  ctx: ActionContext,
  provider: 'google',
): Promise<GoogleCredential | null>
export function getProviderCredential(
  ctx: ActionContext,
  provider: 'anthropic' | 'perplexity',
): Promise<ApiKeyCredential | null>
export function getProviderCredential(
  ctx: ActionContext,
  provider: 'granola',
): Promise<GranolaCredential | null>
export function getProviderCredential(
  ctx: ActionContext,
  provider: CredentialProvider,
): Promise<ProviderCredential | null>
export async function getProviderCredential(
  ctx: ActionContext,
  provider: CredentialProvider,
): Promise<ProviderCredential | null> {
  // loadConnection scopes per-attorney providers to ctx.actorId and treats the
  // firm-wide AI keys as actor_id NULL (connectionStore.ownerActor). It returns
  // null for a disconnected/absent connection — so an attorney who hasn't
  // connected, or who disconnected, gets no credential. Vault is the only source.
  switch (provider) {
    case 'google': {
      const conn = await loadConnection<GoogleSecret>(ctx.tenantId, 'google', ctx.actorId)
      if (!conn) return null
      return {
        provider: 'google',
        accountEmail: conn.info.accountEmail,
        accessToken: conn.secret.accessToken,
        refreshToken: conn.secret.refreshToken,
        expiresAt: conn.secret.expiresAt,
        scope: conn.secret.scope,
        calendarId: conn.secret.calendarId,
      }
    }
    case 'anthropic':
    case 'perplexity': {
      const conn = await loadConnection<ApiKeySecret>(ctx.tenantId, provider, ctx.actorId)
      if (!conn?.secret.api_key) return null
      return { provider, apiKey: conn.secret.api_key }
    }
    case 'granola': {
      const conn = await loadConnection<GranolaSecret>(ctx.tenantId, 'granola', ctx.actorId)
      if (!conn?.secret?.accessToken) return null
      const { accessToken, refreshToken, expiresAt, scope } = conn.secret
      return { provider: 'granola', accessToken, refreshToken, expiresAt, scope: scope ?? null }
    }
    default: {
      // Exhaustiveness guard: a new provider must be wired here explicitly.
      const _never: never = provider
      throw new Error(`getProviderCredential: unsupported provider ${String(_never)}`)
    }
  }
}

// ── getConnectionStatus — probe-verified status, no secrets ───────────────────
export async function getConnectionStatus(
  ctx: ActionContext,
  provider: CredentialProvider,
): Promise<ConnectionStatusResult> {
  const info = await getConnectionInfo(ctx.tenantId, provider, ctx.actorId)
  if (!info) {
    return { status: 'disconnected', lastProbeAt: null, accountEmail: null }
  }
  const lastProbeAt =
    info.detail && typeof info.detail.last_probe_at === 'string'
      ? (info.detail.last_probe_at as string)
      : null
  return {
    status: info.status,
    detail: info.lastError ?? undefined,
    lastProbeAt,
    accountEmail: info.accountEmail,
  }
}
