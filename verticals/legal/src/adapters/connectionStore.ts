// Integration credential storage: secret material in Supabase Vault, connection
// metadata in legal_integration_connection (vertical migrations 0002, 0016).
// REQ-SEC-01: tokens and API keys never touch a plaintext table column. Server-
// side only — Vault decryption requires the owner connection (withSuperuser), so
// nothing here is reachable from client bundles.
//
// Per migration 0016, PERSONAL integrations (google, granola) are scoped to the
// connecting attorney (actor_id) — each attorney connects and sees their own.
// FIRM-WIDE resources (AI keys: anthropic/openai/perplexity) keep actor_id NULL
// because the async drafting worker loads them as the agent actor, not a
// logged-in attorney. Pass the attorney's actorId for personal providers; omit it
// (or pass null) for firm-wide ones.
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

// Providers owned by the individual attorney; everything else is firm-wide.
const PER_ACTOR_PROVIDERS = new Set<string>(['google', 'granola'])

// Sentinel for the (tenant_id, provider, COALESCE(actor_id, …)) unique index
// (migration 0016). No real actor has this id; firm-wide rows keep actor_id NULL
// (the actor FK allows NULL) and only ever match this sentinel in the index.
const FIRM_ACTOR = '00000000-0000-0000-0000-000000000000'

export function isPerActorProvider(provider: string): boolean {
  return PER_ACTOR_PROVIDERS.has(provider)
}

// Public wrappers over the per-row scoping helpers, so the probe action handler
// (which writes the connection row on its own action-transaction client, not
// withSuperuser) can resolve the same owner + Vault-secret name this module uses
// — keeping one source of truth for the (provider, actor) → row/secret mapping.
export function connectionOwner(
  provider: string,
  actorId: string | null | undefined,
): string | null {
  return ownerActor(provider, actorId)
}
export function integrationSecretName(
  tenantId: string,
  provider: string,
  owner: string | null,
): string {
  return secretName(tenantId, provider, owner)
}
// The (tenant, provider, COALESCE(actor_id, FIRM_ACTOR_SENTINEL)) uniqueness slot
// (migration 0016). Exported so the probe handler's ON CONFLICT targets the same
// index expression this module relies on.
export const FIRM_ACTOR_SENTINEL = FIRM_ACTOR

// The actor that OWNS a connection for (provider, requesting actor): the attorney
// for personal providers, null (firm-wide) otherwise. A personal provider with no
// actorId resolves to null too — which only matches the empty post-migration
// firm-wide slot, never another attorney's credentials.
function ownerActor(provider: string, actorId: string | null | undefined): string | null {
  return isPerActorProvider(provider) ? (actorId ?? null) : null
}

// Vault secret name is per-row: include the owning attorney for personal providers
// so two attorneys' Google tokens never collide on one name.
function secretName(tenantId: string, provider: string, owner: string | null): string {
  return owner ? `legal/${provider}/${tenantId}/${owner}` : `legal/${provider}/${tenantId}`
}

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

// Connect (or refresh) a provider for an attorney (or firm-wide): write the secret
// to Vault and upsert the metadata row. The caller records the connect/disconnect
// as an action (config.change) — this module is storage only.
export async function saveConnection(
  tenantId: string,
  provider: string,
  secret: unknown,
  meta: ConnectionMeta = {},
  actorId?: string | null,
): Promise<void> {
  const owner = ownerActor(provider, actorId)
  const name = secretName(tenantId, provider, owner)
  await withSuperuser(async (client) => {
    await upsertVaultSecret(client, name, JSON.stringify(secret))
    await client.query(
      `INSERT INTO legal_integration_connection
         (tenant_id, actor_id, provider, status, account_email, scope, vault_secret_name, expires_at, last_error, detail, updated_at)
       VALUES ($1, $8, $2, 'connected', $3, $4, $5, $6, NULL, $7::jsonb, now())
       ON CONFLICT (tenant_id, provider, COALESCE(actor_id, '${FIRM_ACTOR}'::uuid)) DO UPDATE SET
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
        owner,
      ],
    )
  })
}

// Read the decrypted secret + metadata for an attorney's (or firm-wide)
// connection. Returns null when not connected.
export async function loadConnection<T>(
  tenantId: string,
  provider: string,
  actorId?: string | null,
): Promise<{ secret: T; info: ConnectionInfo } | null> {
  const owner = ownerActor(provider, actorId)
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow & { decrypted_secret: string | null }>(
      `SELECT c.provider, c.status, c.account_email, c.scope, c.expires_at, c.last_error,
              c.detail, c.connected_at, c.updated_at, s.decrypted_secret
       FROM legal_integration_connection c
       LEFT JOIN vault.decrypted_secrets s ON s.name = c.vault_secret_name
       WHERE c.tenant_id = $1 AND c.provider = $2
         AND COALESCE(c.actor_id, '${FIRM_ACTOR}'::uuid) = COALESCE($3::uuid, '${FIRM_ACTOR}'::uuid)
         AND c.status <> 'disconnected'`,
      [tenantId, provider, owner],
    )
    const row = res.rows[0]
    if (!row || row.decrypted_secret == null) return null
    return { secret: JSON.parse(row.decrypted_secret) as T, info: mapInfo(row) }
  })
}

export async function getConnectionInfo(
  tenantId: string,
  provider: string,
  actorId?: string | null,
): Promise<ConnectionInfo | null> {
  const owner = ownerActor(provider, actorId)
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow>(
      `SELECT ${INFO_COLS}
       FROM legal_integration_connection
       WHERE tenant_id = $1 AND provider = $2
         AND COALESCE(actor_id, '${FIRM_ACTOR}'::uuid) = COALESCE($3::uuid, '${FIRM_ACTOR}'::uuid)`,
      [tenantId, provider, owner],
    )
    return res.rows[0] ? mapInfo(res.rows[0]) : null
  })
}

// List the attorney's OWN personal connections plus the firm-wide ones (so the
// Settings page shows their Google/Granola + the firm AI keys). Omit actorId to
// list everything (admin/diagnostic).
export async function listConnections(
  tenantId: string,
  actorId?: string | null,
): Promise<ConnectionInfo[]> {
  return withSuperuser(async (client) => {
    const res = await client.query<InfoRow>(
      `SELECT ${INFO_COLS}
       FROM legal_integration_connection
       WHERE tenant_id = $1
         AND ($2::uuid IS NULL OR actor_id = $2::uuid OR actor_id IS NULL)
       ORDER BY provider`,
      [tenantId, actorId ?? null],
    )
    return res.rows.map(mapInfo)
  })
}

// The attorney whose connection firm-level flows use when no specific attorney is
// in context — the public booking event + automated emails. Until per-attorney
// booking links land (track B), this is the firm's primary (earliest-connected)
// attorney for the provider. Returns null if none is connected.
export async function resolveFirmPrimaryActor(
  tenantId: string,
  provider: string,
): Promise<string | null> {
  if (!isPerActorProvider(provider)) return null
  return withSuperuser(async (client) => {
    const res = await client.query<{ actor_id: string | null }>(
      `SELECT actor_id
       FROM legal_integration_connection
       WHERE tenant_id = $1 AND provider = $2 AND status = 'connected' AND actor_id IS NOT NULL
       ORDER BY connected_at ASC
       LIMIT 1`,
      [tenantId, provider],
    )
    return res.rows[0]?.actor_id ?? null
  })
}

// A failed refresh or API call flips the connection to 'error' so the UI surfaces
// it (a silently dead calendar sync = missed consultations).
export async function markConnectionError(
  tenantId: string,
  provider: string,
  error: string,
  actorId?: string | null,
): Promise<void> {
  const owner = ownerActor(provider, actorId)
  await withSuperuser(async (client) => {
    await client.query(
      `UPDATE legal_integration_connection
       SET status = 'error',
           last_error = left($3, 500),
           detail = legal_integration_connection.detail || jsonb_build_object('last_probe_at', now()),
           updated_at = now()
       WHERE tenant_id = $1 AND provider = $2
         AND COALESCE(actor_id, '${FIRM_ACTOR}'::uuid) = COALESCE($4::uuid, '${FIRM_ACTOR}'::uuid)
         AND status <> 'disconnected'`,
      [tenantId, provider, error, owner],
    )
  })
}

// Disconnect: remove the secret from Vault; keep the metadata row as the visible
// "disconnected" state with a reconnect path in the UI.
export async function disconnect(
  tenantId: string,
  provider: string,
  actorId?: string | null,
): Promise<void> {
  const owner = ownerActor(provider, actorId)
  const name = secretName(tenantId, provider, owner)
  await withSuperuser(async (client) => {
    await client.query(`DELETE FROM vault.secrets WHERE name = $1`, [name])
    await client.query(
      `UPDATE legal_integration_connection
       SET status = 'disconnected', updated_at = now()
       WHERE tenant_id = $1 AND provider = $2
         AND COALESCE(actor_id, '${FIRM_ACTOR}'::uuid) = COALESCE($3::uuid, '${FIRM_ACTOR}'::uuid)`,
      [tenantId, provider, owner],
    )
  })
}
