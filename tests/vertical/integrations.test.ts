// Settings → Integrations: API keys managed in the UI, stored in Vault only.
// Verifies the runtime contract the Settings cards promise:
//   - a saved key is what the drafting adapter actually resolves (Vault beats env)
//   - listIntegrationStatuses never leaks secret material (last_four only)
//   - replacing the Granola API key preserves the webhook secret in the shared
//     Vault record; an explicit new webhook secret replaces it
//   - disconnect removes the Vault secret and falls resolution back to env
// DB-gated; runs against the shared dev DB, so any pre-existing connection
// state for the touched providers is captured first and restored after.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import pg from 'pg'

const url = process.env.SUBSTRATE_TEST_DATABASE_URL ?? process.env.DATABASE_URL
if (url && !process.env.DATABASE_URL) process.env.DATABASE_URL = url
const run = describe.skipIf(!url)

import {
  listIntegrationStatuses,
  persistIntegrationKey,
  disconnectIntegration,
  resolveAnthropicApiKey,
  saveConnection,
  loadConnection,
  disconnect,
} from '@exsto/legal'
import { closeDbPool } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ctx: ActionContext = {
  tenantId: TENANT,
  actorId: '00000000-0000-0000-0001-000000000002',
}

const TOUCHED = ['anthropic', 'granola'] as const
type Saved = { secret: unknown; detail: Record<string, unknown> } | null

run('integration key management (live DB)', { timeout: 90_000 }, () => {
  const db = new pg.Pool({ connectionString: url })
  const prior = new Map<string, Saved>()
  const priorEnvKey = process.env.ANTHROPIC_API_KEY

  beforeAll(async () => {
    for (const p of TOUCHED) {
      const conn = await loadConnection<unknown>(TENANT, p)
      prior.set(p, conn ? { secret: conn.secret, detail: conn.info.detail } : null)
    }
  })

  afterAll(async () => {
    for (const p of TOUCHED) {
      const before = prior.get(p)
      if (before) {
        await saveConnection(TENANT, p, before.secret, { detail: before.detail })
      } else {
        await disconnect(TENANT, p)
      }
    }
    if (priorEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = priorEnvKey
    await db.end()
    await closeDbPool()
  })

  it('a saved Anthropic key is what the drafting adapter resolves (Vault beats env)', async () => {
    process.env.ANTHROPIC_API_KEY = 'sk-env-platform-default'
    await persistIntegrationKey(ctx, { provider: 'anthropic', apiKey: 'sk-vault-test-7788' })

    const resolved = await resolveAnthropicApiKey(TENANT)
    expect(resolved).toEqual({ apiKey: 'sk-vault-test-7788', source: 'connection' })
  })

  it('statuses expose last_four and never the key itself', async () => {
    const statuses = await listIntegrationStatuses(ctx)
    const anthropic = statuses.find((s) => s.provider === 'anthropic')
    expect(anthropic?.connected).toBe(true)
    expect(anthropic?.lastFour).toBe('7788')
    expect(JSON.stringify(statuses)).not.toContain('sk-vault-test-7788')
  })

  it('replacing the Granola key preserves the webhook secret; explicit secret replaces it', async () => {
    await persistIntegrationKey(ctx, {
      provider: 'granola',
      apiKey: 'gk-one',
      webhookSecret: 'whs-original',
    })
    await persistIntegrationKey(ctx, { provider: 'granola', apiKey: 'gk-two' })

    let conn = await loadConnection<{ api_key: string; webhook_secret?: string }>(TENANT, 'granola')
    expect(conn?.secret).toEqual({ api_key: 'gk-two', webhook_secret: 'whs-original' })

    await persistIntegrationKey(ctx, {
      provider: 'granola',
      apiKey: 'gk-three',
      webhookSecret: 'whs-rotated',
    })
    conn = await loadConnection<{ api_key: string; webhook_secret?: string }>(TENANT, 'granola')
    expect(conn?.secret).toEqual({ api_key: 'gk-three', webhook_secret: 'whs-rotated' })
  })

  it('disconnect removes the Vault secret and resolution falls back to env, then errors helpfully', async () => {
    await disconnectIntegration(ctx, 'anthropic')

    expect(await loadConnection(TENANT, 'anthropic')).toBeNull()

    // The disconnect is audited through the action layer (config.change) —
    // and the audit row carries no secret material.
    const audit = await db.query<{ after_value: Record<string, unknown> }>(
      `SELECT after_value FROM configuration_change
       WHERE tenant_id = $1 AND change_reason = 'integration disconnected via Settings'
         AND after_value->>'provider' = 'anthropic'
         AND recorded_at > now() - interval '2 minutes'`,
      [TENANT],
    )
    expect(audit.rows.length).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(audit.rows)).not.toContain('sk-vault-test')
    const statuses = await listIntegrationStatuses(ctx)
    expect(statuses.find((s) => s.provider === 'anthropic')?.connected).toBe(false)

    process.env.ANTHROPIC_API_KEY = 'sk-env-platform-default'
    expect(await resolveAnthropicApiKey(TENANT)).toEqual({
      apiKey: 'sk-env-platform-default',
      source: 'env',
    })

    delete process.env.ANTHROPIC_API_KEY
    await expect(resolveAnthropicApiKey(TENANT)).rejects.toThrow(/Settings → Integrations/)
  })
})
