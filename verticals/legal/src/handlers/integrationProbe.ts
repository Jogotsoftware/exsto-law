// Handler for legal.integration.probe (vertical migration 0027).
//
// A probe is the result of a live capability check on a provider connection
// (Google: Gmail profile read + Calendar list; API keys: a provider ping). This
// handler IS the write path for the resulting status transition, so the
// connection-row update commits atomically with the action + event — the status
// change goes through the operation core (CLAUDE.md hard rule 1), not a side
// write. submitAction also refuses effect-less actions, so this handler always
// performs a real connection-row write.
//
//   outcome 'connected' — the credential was already stored by the connect flow
//     (Vault, via connectionStore.saveConnection, which set status='connected');
//     this stamps last_probe_at and clears any stale error on the existing row.
//   outcome 'error' — upsert the row to 'error' with the (already-redacted)
//     detail. Works for a first-ever connect that never stored a secret
//     (vault_secret_name is set to the conventional name; no secret lives there,
//     so the credential reads as absent) as well as flipping an existing row.
//
// The payload carries NO secret material: provider + outcome + a scrubbed detail
// + the connecting attorney (to resolve the per-actor row, migration 0016) only.
import { registerActionHandler } from '@exsto/substrate'
import {
  connectionOwner,
  integrationSecretName,
  FIRM_ACTOR_SENTINEL,
} from '../adapters/connectionStore.js'

interface ProbePayload {
  provider: string
  outcome: 'connected' | 'error'
  detail?: string | null
  accountEmail?: string | null
  // Connecting attorney for per-actor providers (google/granola); null/omitted
  // for firm-wide AI keys (anthropic/perplexity).
  actorId?: string | null
}

// Fixed UUID sentinel for the firm-wide (actor_id NULL) slot. Interpolated as a
// LITERAL — not a bound parameter — so the ON CONFLICT expression matches migration
// 0016's unique index `(tenant_id, provider, COALESCE(actor_id, <sentinel>))`
// exactly. It is a constant UUID, never user input, so this is injection-safe.
const FIRM = FIRM_ACTOR_SENTINEL

registerActionHandler('legal.integration.probe', async (ctx, client, payload) => {
  const p = payload as unknown as ProbePayload
  const owner = connectionOwner(p.provider, p.actorId ?? null)

  if (p.outcome === 'connected') {
    const res = await client.query(
      `UPDATE legal_integration_connection
       SET status = 'connected',
           last_error = NULL,
           account_email = COALESCE($4, account_email),
           detail = detail || jsonb_build_object('last_probe_at', now()),
           updated_at = now()
       WHERE tenant_id = $1 AND provider = $2
         AND COALESCE(actor_id, '${FIRM}'::uuid) = COALESCE($3::uuid, '${FIRM}'::uuid)`,
      [ctx.tenantId, p.provider, owner, p.accountEmail ?? null],
    )
    return { provider: p.provider, outcome: 'connected', rowsUpdated: res.rowCount }
  }

  const name = integrationSecretName(ctx.tenantId, p.provider, owner)
  const res = await client.query(
    `INSERT INTO legal_integration_connection
       (tenant_id, actor_id, provider, status, account_email, vault_secret_name, last_error, detail, updated_at)
     VALUES ($1, $3, $2, 'error', $6, $4, left($5, 500),
             jsonb_build_object('last_probe_at', now()), now())
     ON CONFLICT (tenant_id, provider, COALESCE(actor_id, '${FIRM}'::uuid)) DO UPDATE SET
       status = 'error',
       account_email = COALESCE(EXCLUDED.account_email, legal_integration_connection.account_email),
       last_error = EXCLUDED.last_error,
       detail = legal_integration_connection.detail || jsonb_build_object('last_probe_at', now()),
       updated_at = now()`,
    [ctx.tenantId, p.provider, owner, name, p.detail ?? 'probe failed', p.accountEmail ?? null],
  )
  return { provider: p.provider, outcome: 'error', rowsAffected: res.rowCount }
})
