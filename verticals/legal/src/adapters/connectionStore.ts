// Integration credential storage: secret material in Supabase Vault, connection
// metadata in legal_integration_connection (vertical migration 0002). REQ-SEC-01:
// tokens and API keys never touch a plaintext table column. Server-side only —
// Vault decryption requires the owner connection (withSuperuser), so nothing in
// here is reachable from client bundles.
import { withSuperuser, type DbClient } from '@exsto/shared'

export type ConnectionStatus = 'connected' | 'error' | 'disconnected'

export interface ConnectionInfo {
  provider: string
  status: ConnectionStatus
  accountEmail: string | null
  scope: string | null
  expiresAt: Date | null
  lastError: string | null
  detail: Record<string, unknown>
  connectedAt: Date
  updatedAt: Date
}

export interface ConnectionMeta {
  accountEmail?: string | null
  scope?: string | null
  expiresAt?: Date | null
  // Non-secret display metadata (key last-four, calendar id, ...). Never put
  // secret material here — secrets go in the Vault payload only.
  detail?: Record<string, unknown>
}

const secretName = (tenantId: string, provider: string) => `legal/${provider}/${tenantId}`

type InfoRow = {
  provider: string
  status: ConnectionStatus
  account_email: string | null
  scope: string | null
  expires_at: Date | null
  last_error: string | null
  detail: Record<string, unknown>
  connected_at: Date
  updated_at: Date
}

const INFO_COLS = `provider, status, account_email, scope, expires_at, last_error, detail, connected_at, updated_at`

function mapInfo(r: InfoRow): ConnectionInfo {
  return {
    provider: r.provider,
    status: r.status,
    accountEmail: r.account_email,
    scope: r.scope,
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
    lastError: r.last_error,
    detail: r.detail ?? {},
    connectedAt: new Date(r.connected_at),
    updatedAt: new Date(r.updated_at),
  }
}

async function upsertVaultSecret(client: DbClient, name: string, secret: string): Promise<void> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM vault.secrets WHERE name = $1`,
    [name],
  )
  if (existing.rows[0]) {
    await client.query(`SELECT vault.update_secret($1::uuid, $2)`, [existing.rows[0].id, secret])
  } else {
    await client.query(`SELECT vault.create_secret($1, $2)`, [secret, name])
  }
}

// Connect (or refresh) a provider: write the secret to Vault and upsert the
// metadata row. The caller is responsible for recording the connect/disconnect
// as an action (config.change) — this module is storage only.
export async function saveConnection(
  tenantId: string,
  provider: string,
  secret: unknown,
  meta: ConnectionMeta = {},
): Promise<void> {
  const name = secretName(tenantId, provider)
  await withSuperuser(async (client) => {
    await upsertVaultSecret(client, name, JSON.stringify(secret))
    await client.query(
      `INSERT INTO legal_integration_connection
         (tenant_id, provider, status, account_email, scope, vault_secret_name, expires_at, last_error, detail, updated_at)
       VALUES ($1, $2, 'connected', $3, $4, $5, $6, NULL, $7::jsonb, now())
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status = 'connected',
         account_email = COALESCE(EXCLUDED.account_email, legal_integration_connection.account_email),
         scope = COALESCE(EXCLUDED.scope, legal_integration_connection.scope),
         vault_secret_name = EXCLUDED.vault_secret_name,
         expires_at = EXCLUDED.expires_at,
         last_error = NULL,
         detail = legal_integration_connection.detail || EXCLUDED.detail,
         updated_at = now()`,
      [
        tenantId,
        provider,
        meta.accountEmail ?? null,
        meta.scope ?? null,
        name,
        meta.expiresAt ?? null,
        JSON.stringify(meta.detail ?? {}),
      ],
    )
  })
}

// Read the decrypted secret + metadata. Returns null when not connected (a
// disconnected provider's secret is already gone from Vault).
export async function loadConnection<T>(
  tenantId: string,
  provider: string,
): Promise<{ secret: T; info: ConnectionInfo } | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow & { decrypted_secret: string | null }>(
      `SELECT c.provider, c.status, c.account_email, c.scope, c.expires_at, c.last_error,
              c.detail, c.connected_at, c.updated_at, s.decrypted_secret
       FROM legal_integration_connection c
       LEFT JOIN vault.decrypted_secrets s ON s.name = c.vault_secret_name
       WHERE c.tenant_id = $1 AND c.provider = $2 AND c.status <> 'disconnected'`,
      [tenantId, provider],
    )
    const row = res.rows[0]
    if (!row || row.decrypted_secret == null) return null
    return { secret: JSON.parse(row.decrypted_secret) as T, info: mapInfo(row) }
  })
}

export async function getConnectionInfo(
  tenantId: string,
  provider: string,
): Promise<ConnectionInfo | null> {
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow>(
      `SELECT ${INFO_COLS}
       FROM legal_integration_connection WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider],
    )
    return res.rows[0] ? mapInfo(res.rows[0]) : null
  })
}

export async function listConnections(tenantId: string): Promise<ConnectionInfo[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow>(
      `SELECT ${INFO_COLS}
       FROM legal_integration_connection WHERE tenant_id = $1 ORDER BY provider`,
      [tenantId],
    )
    return res.rows.map(mapInfo)
  })
}

// A failed refresh or API call flips the connection to 'error' so the UI can
// surface it prominently (a silently dead calendar sync = missed consultations).
export async function markConnectionError(
  tenantId: string,
  provider: string,
  error: string,
): Promise<void> {
  await withSuperuser(async (client) => {
    await client.query(
      `UPDATE legal_integration_connection
       SET status = 'error', last_error = left($3, 500), updated_at = now()
       WHERE tenant_id = $1 AND provider = $2 AND status <> 'disconnected'`,
      [tenantId, provider, error],
    )
  })
}

// Disconnect: remove the secret from Vault entirely; keep the metadata row as
// the visible "disconnected" state with a reconnect path in the UI.
export async function disconnect(tenantId: string, provider: string): Promise<void> {
  const name = secretName(tenantId, provider)
  await withSuperuser(async (client) => {
    await client.query(`DELETE FROM vault.secrets WHERE name = $1`, [name])
    await client.query(
      `UPDATE legal_integration_connection
       SET status = 'disconnected', updated_at = now()
       WHERE tenant_id = $1 AND provider = $2`,
      [tenantId, provider],
    )
  })
}
