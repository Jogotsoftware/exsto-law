import { Pool, type PoolClient } from 'pg'
import type { ActorId, TenantId } from './types.js'

// Lazy pool init: the env check is deferred until first use so Next.js build
// / static analysis can import @exsto/shared without DATABASE_URL set. Runtime
// callers see the same singleton.
let _pool: Pool | undefined

function getPool(): Pool {
  if (_pool) return _pool
  // Accept either DATABASE_URL (canonical) or SUPABASE_DATABASE_URL
  // (auto-set by Netlify's Supabase integration). Pick whichever is set.
  const databaseUrl =
    process.env.DATABASE_URL ??
    process.env.SUPABASE_DATABASE_URL ??
    process.env.SUPABASE_DB_URL ??
    process.env.POSTGRES_URL
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. In Netlify, set DATABASE_URL (or SUPABASE_DATABASE_URL) to the exsto-wedge pooler URL with the DB password.',
    )
  }
  _pool = new Pool({ connectionString: databaseUrl })
  return _pool
}

export type DbClient = PoolClient

export async function getDbPool(): Promise<Pool> {
  return getPool()
}

// Optional non-owner role for operations (ADR 0037). When the deployment connects
// as an owner / `authenticator` login role, set SUBSTRATE_DB_ROLE=authenticated so
// every operation runs under RLS regardless of the login role — defense in depth.
// Unset = use the connection role as-is (the prior behaviour). Validated to a bare
// identifier so it is safe to interpolate into SET LOCAL ROLE.
function appDbRole(): string | null {
  const role = process.env.SUBSTRATE_DB_ROLE
  if (!role) return null
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) {
    throw new Error(`Invalid SUBSTRATE_DB_ROLE (must be a bare SQL identifier): ${role}`)
  }
  return role
}

// Runs callback under the configured app role (if any) with NO tenant binding, in
// a committed transaction. For cross-tenant auth infrastructure that must resolve
// before a tenant is known — e.g. an API-key lookup via a SECURITY DEFINER
// function. Application substrate writes still go through withTenant.
export async function withAppRole<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const role = appDbRole()
    if (role) await client.query(`SET LOCAL ROLE ${role}`)
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback error; original error is what matters
    }
    throw error
  } finally {
    client.release()
  }
}

// Closes the shared pool. Use only at process exit (CLI scripts, tests); a
// long-running process should leave the pool open so it can keep serving.
export async function closeDbPool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = undefined
  }
}

// Runs a one-off query as the connecting role with no tenant binding. Useful
// only for migrations, seed scripts, and other process-bypass operations.
// Application code must never call this directly — use withTenant.
export async function withSuperuser<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    return await callback(client)
  } finally {
    client.release()
  }
}

// Runs callback inside a transaction with RLS session variables (tenant_id
// and optionally actor_id) bound via SET LOCAL so they auto-clear at COMMIT
// and never leak across pool checkouts. Every substrate write path must flow
// through here so RLS is engaged with a tenant context (invariant 1).
export async function withTenant<T>(
  tenantId: TenantId,
  callback: (client: DbClient) => Promise<T>,
  options?: { actorId?: ActorId },
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    // Drop to the non-owner app role (if configured) so RLS is engaged even when
    // the connection logs in as an owner / authenticator role (ADR 0037).
    const role = appDbRole()
    if (role) await client.query(`SET LOCAL ROLE ${role}`)
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId])
    if (options?.actorId) {
      await client.query("SELECT set_config('app.actor_id', $1, true)", [options.actorId])
    }
    const result = await callback(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try {
      await client.query('ROLLBACK')
    } catch {
      // ignore rollback error; original error is what matters
    }
    throw error
  } finally {
    client.release()
  }
}
