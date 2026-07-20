import { Pool, type PoolClient, type PoolConfig } from 'pg'
import type { ActorId, TenantId } from './types.js'

// Lazy pool init: the env check is deferred until first use so Next.js build
// / static analysis can import @exsto/shared without DATABASE_URL set. Runtime
// callers see the same singleton.
let _pool: Pool | undefined

// Bound the pool and let idle connections drop. The app runs as many short-lived
// serverless instances (Netlify Functions / AWS Lambda), each with its own pool;
// against Supabase's session-mode pooler (a hard 15-client cap) an unbounded
// per-instance pool exhausts connections fast — the "max clients reached in session
// mode - max clients are limited to pool_size: 15" 500s on the dashboard. So:
//   • keep each serverless instance's pool tiny (it only serves one request at a
//     time anyway) and reap idle connections quickly so they return to the pooler;
//   • the long-running worker is a single process, so it can hold a few more.
// DATABASE_POOL_MAX overrides either default.
//
// DURABLE FIX (B3.3): right-sizing (above) alone did NOT stop the intermittent
// 500s — session-mode pins one Postgres backend per pooled client, so even small
// per-instance pools across many warm Lambdas re-saturate the 15-slot cap (17 idle
// session-pinned backends vs 1 active, observed). The fix is to point the *app*
// DATABASE_URL at the TRANSACTION-mode pooler (port 6543), which assigns a backend
// per transaction and multiplexes instead of capping clients. That is safe here
// because EVERY app DB path is transaction-scoped: withTenant/withActionContext/
// withAppRole all set their tenant/role GUCs with SET LOCAL semantics inside
// BEGIN/COMMIT (no cross-transaction GUC leak), and withSuperuser is now wrapped in
// a transaction too. This config is correct under BOTH pooler modes, so the env
// flip needs no code change and is reversible. The single-process worker (Render)
// and migrations stay on the session/direct URL. See PR body for the exact env.
function buildPoolConfig(connectionString: string): PoolConfig {
  const serverless = Boolean(
    process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY || process.env.VERCEL,
  )
  const envMax = Number(process.env.DATABASE_POOL_MAX)
  const max = Number.isFinite(envMax) && envMax > 0 ? Math.floor(envMax) : serverless ? 3 : 10
  return {
    connectionString,
    max,
    // Free idle connections back to the pooler rather than holding the slot.
    idleTimeoutMillis: 10_000,
    // Fail fast instead of hanging a request when the pooler is saturated.
    connectionTimeoutMillis: 10_000,
    // Don't let an idle pool keep a frozen Lambda's connections alive.
    allowExitOnIdle: serverless,
  }
}

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
  _pool = new Pool(buildPoolConfig(databaseUrl))
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

// Runs the callback as the connecting role with no tenant binding, inside a
// single committed transaction. Used for cross-tenant auth infrastructure that
// resolves before a tenant is known (email→user lookups, connection-secret
// read-then-write) plus migrations, seed scripts, and worker queue ops.
// Application substrate writes still go through withTenant.
//
// The BEGIN/COMMIT wrapper is what makes this safe under a TRANSACTION-mode
// pooler (port 6543): that pooler assigns a server backend per transaction, so a
// multi-statement callback that ran statement-by-statement in autocommit could
// land each statement on a different backend (breaking a read-then-write or a
// DELETE+UPDATE pair). Pinning the whole callback to one transaction keeps it on
// one backend and atomic. Under a session-mode pooler the wrapper is a harmless
// no-op (the checkout already pins one backend for its lifetime). No caller
// issues its own BEGIN/COMMIT (verified) and none runs a transaction-forbidden
// statement (CREATE INDEX CONCURRENTLY / VACUUM), so the wrap is universally safe.
export async function withSuperuser<T>(callback: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
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
