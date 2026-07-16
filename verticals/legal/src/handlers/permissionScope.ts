// CLIENT-PORTAL-UI-1 CORRECTIVE (WP-C1, migration 0162) — permission_scope.amend.
//
// The ONLY sanctioned way to change a permission scope's action_kinds allowlist.
// The scope-def id must stay stable (actor_scope_assignment hard-binds to it;
// enforcement joins by id — 0073), so this is an IN-PLACE amendment whose
// provenance is this action: the handler re-points the row's action_id and
// moves valid_from/recorded_at to the amendment time, all inside the action's
// transaction. A bare UPDATE detached from an action (how 0161 first shipped
// the allowlist change) is exactly the provenance break this kind closes.
//
// FOLLOW-UP (logged, not fixed here): assignments binding to the physical
// versioned scope-def id makes scope definitions un-supersedable without a
// re-point cascade — assignments should resolve the current version by logical
// key. Parked for FIRM-PROVISIONING / substrate cleanup.
import { registerActionHandler } from '@exsto/substrate'

interface AmendPayload {
  scope_name?: string
  add_action_kinds?: string[]
  reason?: string
}

registerActionHandler('permission_scope.amend', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as AmendPayload
  const scopeName = (p.scope_name ?? '').trim()
  if (!scopeName) throw new Error('scope_name is required.')
  const kinds = (p.add_action_kinds ?? []).map((k) => String(k).trim()).filter(Boolean)
  if (kinds.length === 0) throw new Error('add_action_kinds must name at least one action kind.')

  // Never allowlist a ghost: every named kind must be a real, active definition
  // in this tenant.
  const known = await client.query<{ kind_name: string }>(
    `SELECT DISTINCT kind_name FROM action_kind_definition
     WHERE tenant_id = $1 AND kind_name = ANY($2::text[]) AND status = 'active'`,
    [ctx.tenantId, kinds],
  )
  const knownSet = new Set(known.rows.map((r) => r.kind_name))
  const ghosts = kinds.filter((k) => !knownSet.has(k))
  if (ghosts.length > 0) {
    throw new Error(`Unknown action kind(s): ${ghosts.join(', ')} — seed the definition first.`)
  }

  const scopeRes = await client.query<{ id: string; action_kinds: string[] }>(
    `SELECT id, action_kinds FROM permission_scope_definition
     WHERE tenant_id = $1 AND scope_name = $2 AND status = 'active'
       AND (valid_to IS NULL OR valid_to > now())
     ORDER BY valid_from DESC
     LIMIT 1
     FOR UPDATE`,
    [ctx.tenantId, scopeName],
  )
  const scope = scopeRes.rows[0]
  if (!scope) throw new Error(`No active permission scope named '${scopeName}'.`)

  const current = new Set(scope.action_kinds)
  const added = kinds.filter((k) => !current.has(k))
  const ensured = kinds.filter((k) => current.has(k))
  const next = [...scope.action_kinds, ...added]

  // The amendment's effect: content (idempotent append) + PROVENANCE — the row
  // now points at THIS action, effective from now. Sealed history stays in the
  // ledger (this action's payload records exactly what was amended and why).
  await client.query(
    `UPDATE permission_scope_definition
     SET action_kinds = $3::jsonb, action_id = $4, valid_from = now(), recorded_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [scope.id, ctx.tenantId, JSON.stringify(next), actionId],
  )

  return {
    scopeId: scope.id,
    scopeName,
    added,
    ensured,
    actionKinds: next,
  }
})
