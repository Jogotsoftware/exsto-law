// API-key authentication. The presented key identifies the caller; the tenant +
// actor are resolved from it SERVER-SIDE and never read from the request body or
// query (ADR 0038 / invariant 1). Keys are stored hashed (sha256); the raw key is
// shown once at creation.
//
// The lookup is cross-tenant (we don't yet know the tenant), so it goes through
// the SECURITY DEFINER function `auth_resolve_api_key` (migration 0024) called as
// the non-owner app role via withAppRole — auth infrastructure, not an operation
// handler. The function reads api_key by hash with definer rights and returns only
// the principal, so the app connection never needs owner/BYPASSRLS access (ADR
// 0037). Once resolved, every OPERATION runs through the core under the resolved
// tenant (withActionContext binds app.tenant_id, also under the app role).
import { createHash } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { withAppRole } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'
import { ApiError } from './errors.js'

export const API_KEY_PREFIX = 'exsto_'

export function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex')
}

// Accept `Authorization: Bearer <key>` or `X-API-Key: <key>`.
export function extractApiKey(req: IncomingMessage): string | null {
  const auth = req.headers['authorization']
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim() || null
  }
  const x = req.headers['x-api-key']
  if (typeof x === 'string' && x.trim()) return x.trim()
  return null
}

interface ApiKeyRow {
  tenant_id: string
  actor_id: string
}

// Resolve the principal for a presented raw key, or throw 401. Updates
// last_used_at (best-effort, non-blocking).
export async function resolvePrincipal(rawKey: string): Promise<ActionContext> {
  const keyHash = hashKey(rawKey)
  const row = await withAppRole(async (client) => {
    const { rows } = await client.query<ApiKeyRow>(
      `SELECT tenant_id, actor_id FROM private.auth_resolve_api_key($1)`,
      [keyHash],
    )
    return rows[0] ?? null
  })
  if (!row) {
    throw new ApiError(401, 'unauthorized', 'Missing or invalid API key.')
  }
  void withAppRole((client) => client.query(`SELECT private.touch_api_key($1)`, [keyHash])).catch(
    () => {
      /* best-effort; never fail the request on a usage-stamp error */
    },
  )
  return { tenantId: row.tenant_id, actorId: row.actor_id }
}
