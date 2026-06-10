import { withSuperuser } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

export type IntegrationProvider = 'granola' | 'perplexity' | 'anthropic' | 'openai'

export interface IntegrationStatus {
  provider: IntegrationProvider | 'docusign' | 'google_calendar'
  authKind: 'api_key' | 'oauth' | 'coming_soon'
  connected: boolean
  comingSoon?: boolean
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

// Bypass RLS for credential reads/writes — these are tenant-scoped via
// explicit tenantId arguments. We can't expose api_key contents through the
// MCP read path so the action layer never sets app.tenant_id for them.
export async function listIntegrationStatuses(ctx: ActionContext): Promise<IntegrationStatus[]> {
  return withSuperuser(async (client) => {
    const credsRes = await client.query<{
      provider: string
      auth_kind: string
      last_four: string | null
      connected_at: Date
      last_verified_at: Date | null
      last_verify_error: string | null
    }>(
      `SELECT provider, auth_kind, last_four, connected_at, last_verified_at, last_verify_error
       FROM integration_credential WHERE tenant_id = $1`,
      [ctx.tenantId],
    )
    const credMap = new Map(credsRes.rows.map((r) => [r.provider, r]))

    const googleRes = await client.query<{ account_email: string; updated_at: Date }>(
      `SELECT account_email, updated_at FROM google_oauth WHERE tenant_id = $1`,
      [ctx.tenantId],
    )
    const google = googleRes.rows[0] ?? null

    return STATIC_INTEGRATIONS.map(({ provider, authKind, comingSoon }) => {
      if (provider === 'google_calendar') {
        return {
          provider,
          authKind,
          comingSoon: false,
          connected: !!google,
          lastFour: null,
          connectedAt: google?.updated_at?.toISOString() ?? null,
          lastVerifiedAt: google?.updated_at?.toISOString() ?? null,
          lastVerifyError: null,
          accountEmail: google?.account_email ?? null,
        }
      }
      if (comingSoon) {
        return {
          provider,
          authKind,
          comingSoon: true,
          connected: false,
          lastFour: null,
          connectedAt: null,
          lastVerifiedAt: null,
          lastVerifyError: null,
        }
      }
      const c = credMap.get(provider)
      return {
        provider,
        authKind,
        comingSoon: false,
        connected: !!c,
        lastFour: c?.last_four ?? null,
        connectedAt: c?.connected_at?.toISOString() ?? null,
        lastVerifiedAt: c?.last_verified_at?.toISOString() ?? null,
        lastVerifyError: c?.last_verify_error ?? null,
      }
    })
  })
}

// Ping the provider with the supplied key. Returns null on success or an
// error string. Network errors / unexpected status codes are reported.
async function verifyKey(provider: IntegrationProvider, apiKey: string): Promise<string | null> {
  try {
    if (provider === 'anthropic') {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 8,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      })
      if (!r.ok) return `Anthropic returned ${r.status}: ${await safeBody(r)}`
      return null
    }
    if (provider === 'openai') {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { authorization: `Bearer ${apiKey}` },
      })
      if (!r.ok) return `OpenAI returned ${r.status}: ${await safeBody(r)}`
      return null
    }
    if (provider === 'perplexity') {
      const r = await fetch('https://api.perplexity.ai/chat/completions', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'sonar',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 8,
        }),
      })
      if (!r.ok) return `Perplexity returned ${r.status}: ${await safeBody(r)}`
      return null
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
}

export interface ConnectResult {
  ok: boolean
  error?: string
  status?: IntegrationStatus
}

export async function connectIntegration(
  ctx: ActionContext,
  input: ConnectIntegrationInput,
): Promise<ConnectResult> {
  const verifyError = await verifyKey(input.provider, input.apiKey)
  if (verifyError) return { ok: false, error: verifyError }

  const lastFour = input.apiKey.slice(-4)
  await withSuperuser(async (client) => {
    await client.query(
      `INSERT INTO integration_credential (
         tenant_id, provider, auth_kind, credential, last_four,
         connected_at, last_verified_at, last_verify_error
       ) VALUES ($1, $2, 'api_key', $3::jsonb, $4, now(), now(), NULL)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         credential = EXCLUDED.credential,
         last_four = EXCLUDED.last_four,
         connected_at = now(),
         last_verified_at = now(),
         last_verify_error = NULL`,
      [ctx.tenantId, input.provider, JSON.stringify({ api_key: input.apiKey }), lastFour],
    )
  })
  const statuses = await listIntegrationStatuses(ctx)
  const status = statuses.find((s) => s.provider === input.provider)
  return { ok: true, status }
}

export async function disconnectIntegration(
  ctx: ActionContext,
  provider: IntegrationProvider,
): Promise<void> {
  await withSuperuser(async (client) => {
    await client.query(
      `DELETE FROM integration_credential WHERE tenant_id = $1 AND provider = $2`,
      [ctx.tenantId, provider],
    )
  })
}
