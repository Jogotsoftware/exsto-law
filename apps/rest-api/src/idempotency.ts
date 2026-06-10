// Durable idempotency for write requests carrying an `Idempotency-Key` header.
// Backed by the tenant-scoped `idempotency_key` table (migration 0025) so a replay
// is de-duplicated across instances and across restarts — not just within one
// process. Reads/writes run through withTenant, so RLS scopes every row to the
// caller's tenant (the key space is per-tenant).
//
// Flow per write:
//   claim() -> { outcome: 'fresh' }            run the op, then complete()
//            -> { outcome: 'replay', ... }     return the stored response
//            -> { outcome: 'in_progress' }     409 — a duplicate is still running
//            -> { outcome: 'mismatch' }        422 — same key, different request
// On operation failure the caller calls release() so a retry can re-claim the key.
import { createHash } from 'node:crypto'
import { withTenant } from '@exsto/shared'
import type { ActionContext } from '@exsto/substrate'

export interface StoredResponse {
  status: number
  body: unknown
}

export type ClaimResult =
  | { outcome: 'fresh' }
  | { outcome: 'replay'; status: number; body: unknown }
  | { outcome: 'in_progress' }
  | { outcome: 'mismatch' }

// A stable fingerprint of the request so a key replayed with a DIFFERENT body is
// rejected rather than served the first call's cached response.
export function requestFingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256')
    .update(`${method} ${path}\n${JSON.stringify(body ?? {})}`)
    .digest('hex')
}

// Atomically claim the (tenant, key). INSERT wins the race via the primary key;
// a loser inspects the existing row. Expired rows are reclaimed in place.
export async function claimIdempotency(
  ctx: ActionContext,
  key: string,
  fingerprint: string,
): Promise<ClaimResult> {
  return withTenant(
    ctx.tenantId,
    async (client): Promise<ClaimResult> => {
      const inserted = await client.query(
        `INSERT INTO idempotency_key (tenant_id, idempotency_key, request_fingerprint)
         VALUES ($1, $2, $3)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING idempotency_key`,
        [ctx.tenantId, key, fingerprint],
      )
      if ((inserted.rowCount ?? 0) > 0) return { outcome: 'fresh' }

      // Conflict: a row already exists. Inspect it (RLS scopes to this tenant).
      const { rows } = await client.query<{
        status: string
        request_fingerprint: string
        response_status: number | null
        response_body: unknown
        expired: boolean
      }>(
        `SELECT status, request_fingerprint, response_status, response_body,
                (expires_at < now()) AS expired
           FROM idempotency_key
          WHERE idempotency_key = $1`,
        [key],
      )
      const row = rows[0]
      if (!row) return { outcome: 'fresh' } // vanished (TOCTOU); treat as fresh

      // Stale row past its TTL: reclaim it for this request.
      if (row.expired) {
        const reclaimed = await client.query(
          `UPDATE idempotency_key
              SET request_fingerprint = $2, status = 'in_progress',
                  response_status = NULL, response_body = NULL,
                  created_at = now(), completed_at = NULL,
                  expires_at = now() + interval '24 hours'
            WHERE idempotency_key = $1 AND expires_at < now()`,
          [key, fingerprint],
        )
        return (reclaimed.rowCount ?? 0) > 0 ? { outcome: 'fresh' } : { outcome: 'in_progress' }
      }

      if (row.request_fingerprint !== fingerprint) return { outcome: 'mismatch' }
      if (row.status === 'completed' && row.response_status !== null) {
        return { outcome: 'replay', status: row.response_status, body: row.response_body }
      }
      return { outcome: 'in_progress' }
    },
    { actorId: ctx.actorId },
  )
}

// Persist the response for a claimed key so later replays return it verbatim.
export async function completeIdempotency(
  ctx: ActionContext,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  await withTenant(
    ctx.tenantId,
    (client) =>
      client.query(
        `UPDATE idempotency_key
            SET status = 'completed', response_status = $2,
                response_body = $3::jsonb, completed_at = now()
          WHERE idempotency_key = $1`,
        [key, status, JSON.stringify(body)],
      ),
    { actorId: ctx.actorId },
  )
}

// Release a claim (operation failed) by expiring it, so a retry can re-claim.
export async function releaseIdempotency(ctx: ActionContext, key: string): Promise<void> {
  await withTenant(
    ctx.tenantId,
    (client) =>
      client.query(`UPDATE idempotency_key SET expires_at = now() WHERE idempotency_key = $1`, [
        key,
      ]),
    { actorId: ctx.actorId },
  )
}
