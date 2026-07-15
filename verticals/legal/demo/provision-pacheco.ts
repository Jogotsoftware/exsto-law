// FIRM-PROVISIONING-1 — the firm-config half of provisioning the real Pacheco Law
// tenant, THROUGH THE CORE (submitAction only). Run ONCE, after the tenant exists.
//
// Recorded provisioning pathway (all steps carry ledger provenance):
//   * Tenant + owner (Juan) + 4-rung firm RBAC ladder + cloned kind vocabulary:
//       private.cp_bootstrap_tenant(...)  — grants Juan firm.super_admin.
//   * Juan -> firm.attorney (ADDITIVE, keeps super_admin):
//       submitAction 'actor_scope.assign'  (rank-safe: attorney ranks below the granter).
//   * Joe  -> firm.super_admin:
//       private.assign_actor_role(...)  — the SECURITY DEFINER grant cp_bootstrap itself
//       uses for the owner. Required because the actor_scope_assignment rank-enforcement
//       RLS forbids granting firm.super_admin at peer rank through the normal insert path.
//   * Dev tenant re-slug ("Dev Firm" / 'dev-firm'): migration 0166_dev_tenant_reslug.sql.
//
// This script performs the two remaining firm-config actions, which MUST flow through
// their handlers so the firm_settings / firm_profile singletons are built natively:
//   1. firm default rate = $275.00 / USD   (legal.firm.set_default_rate)
//   2. firm profile name = "Pacheco Law"    (legal.firm.set_profile; address/phone left
//      blank — none present on the dev firm, per FIRM-PROVISIONING-1 step 5).
// Engagement terms are DELIBERATELY left unset (the portal/booking render a graceful
// no-terms state; see step 6).
//
//   PROV_TENANT_ID=… PROV_OWNER_ID=… \
//   pnpm --filter @exsto/legal exec tsx --env-file=../../.env.local demo/provision-pacheco.ts
import { closeDbPool } from '@exsto/shared'
import { submitAction, type ActionContext } from '@exsto/substrate'
// Side-effect import: registers the legal action handlers so submitAction can dispatch.
import '@exsto/legal'

function required(name: string): string {
  const v = (process.env[name] ?? '').trim()
  if (!v) throw new Error(`missing env ${name}`)
  return v
}

async function main(): Promise<void> {
  const tenantId = required('PROV_TENANT_ID')
  const owner = required('PROV_OWNER_ID') // Juan (firm owner, firm.super_admin)
  const ctx: ActionContext = { tenantId, actorId: owner }
  const meta = { provisioned_from: 'dev-firm', reason: 'FIRM-PROVISIONING-1' }

  const rate = await submitAction(ctx, {
    actionKindName: 'legal.firm.set_default_rate',
    intentKind: 'enforcement',
    payload: { rate: '275.00', ...meta },
  })
  console.log('set_default_rate', JSON.stringify(rate.effects?.[0] ?? 'ok'))

  const profile = await submitAction(ctx, {
    actionKindName: 'legal.firm.set_profile',
    intentKind: 'enforcement',
    payload: { firm_name: 'Pacheco Law', ...meta },
  })
  console.log('set_profile', JSON.stringify(profile.effects?.[0] ?? 'ok'))
}

main()
  .then(() => closeDbPool())
  .then(() => {
    console.log('PROVISION_CONFIG_OK')
    process.exit(0)
  })
  .catch(async (e: unknown) => {
    console.error('PROVISION_FAILED', e instanceof Error ? e.message : String(e))
    await closeDbPool().catch(() => {})
    process.exit(1)
  })
