// N1 CORRECTIVE — append `legal.client.confirm_portal_email` to every tenant's
// `client.portal` allowlist (0188 seeds the kind but the scope rung must name
// it or the confirm event is silently RBAC-denied), and heal the Pacheco drift:
// tenant ae5530a1 was provisioned (#348) AFTER the 0161-era amend, so its rung
// never got the engagement/notification kinds the three older tenants carry.
// Idempotent: amendPermissionScope reports already-present kinds as `ensured`.
//
// Run AFTER 0188 is applied:  pnpm tsx --env-file=.env.local verticals/legal/demo/n1-allowlist-amend.ts
import '@exsto/legal/mcp'
import { amendPermissionScope } from '@exsto/legal'
import { withActionContext, type ActionContext } from '@exsto/substrate'

const TENANT_ZERO = '00000000-0000-0000-0000-000000000001'
const ATTORNEY = '00000000-0000-0000-0001-000000000002' // Joe Pacheco (firm.super_admin)

const TENANTS = [
  TENANT_ZERO,
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-00fe-000000000001',
  'ae5530a1-05c7-4241-a38e-79bd186c1bbb', // Pacheco Law (provisioned post-0161 — missing engagement kinds)
]

const AMEND_KINDS = [
  'legal.client.confirm_portal_email',
  'legal.engagement.accept',
  'legal.engagement.decline',
  'portal.notification.read',
]

const AMEND_REASON =
  'N1: client.portal must allow legal.client.confirm_portal_email (0188) so the confirmation-return ' +
  'sign-in can record portal.email_confirmed as the client actor. Same amendment ensures the ' +
  '0161-era kinds (engagement accept/decline, notification.read) on tenants provisioned after that ' +
  'amend — Pacheco (ae5530a1) lacked them, which would have RBAC-denied engagement acceptance.'

async function systemActor(tenantId: string): Promise<string> {
  const ctx: ActionContext = { tenantId, actorId: '00000000-0000-0000-0000-000000000000' }
  return withActionContext(ctx, async (c) => {
    const r = await c.query<{ id: string }>(
      `SELECT id FROM actor WHERE tenant_id=$1 AND actor_type='system' AND status='active'
       ORDER BY created_at ASC LIMIT 1`,
      [tenantId],
    )
    const id = r.rows[0]?.id
    if (!id) throw new Error(`tenant ${tenantId} has no system actor`)
    return id
  })
}

async function main(): Promise<void> {
  for (const tenantId of TENANTS) {
    const actorId = tenantId === TENANT_ZERO ? ATTORNEY : await systemActor(tenantId)
    const res = await amendPermissionScope(
      { tenantId, actorId },
      { scopeName: 'client.portal', addActionKinds: AMEND_KINDS, reason: AMEND_REASON },
    )
    console.log(
      `${tenantId} scope=${res.scopeId} added=[${res.added.join(',')}] ensured=[${res.ensured.join(',')}]`,
    )
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e)
    process.exit(1)
  },
)
