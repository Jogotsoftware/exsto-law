// Legal vertical worker process: the generic runtime + this vertical's
// handlers. Run via `pnpm dev:worker` (root) — node --env-file=.env.local.
import './index.js' // registers action handlers (side effect)
import './workers/index.js' // registers vertical worker handlers
import { startWorker } from '@exsto/worker-runtime'
import {
  ensureMeetingReconcileScheduled,
  ensureStaleCapabilityReconcileScheduled,
  ensureStaleDraftReconcileScheduled,
  listWorkerTenants,
} from './workers/index.js'

// Historical single-firm seed — the LAST-RESORT fallback only, used when the
// tenant enumeration itself fails (e.g. migration 0199 not applied yet). The
// normal path below enumerates every active tenant.
const TENANT_ZERO = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

// SECOND-FIRM-1: seed the per-tenant reconcile bootstraps for EVERY active
// tenant (private.worker_list_active_tenants, migration 0199 — excludes the
// platform/sandbox infra tenants in SQL), not just tenant zero. Each ensure*
// function is idempotent per tenant (no-ops when a job is already
// pending/running), so looping all tenants on every boot never double-seeds.
// The reconcile handlers themselves re-enqueue within their OWN tenant
// (enqueueJob({ tenantId: ctx.tenantId, … })), so each firm's chain stays in
// its firm.
const tenants = await listWorkerTenants().catch((err): string[] => {
  console.error(
    '[worker] tenant enumeration failed — falling back to the tenant-zero seed only ' +
      '(is migration 0199 applied?):',
    err,
  )
  return [TENANT_ZERO]
})
if (tenants.length === 0) {
  console.warn('[worker] tenant enumeration returned no active tenants; nothing to bootstrap')
}

for (const tenantId of tenants) {
  // Seed the periodic calendar reconciliation chain (idempotent — no-ops if one
  // is already scheduled). Best-effort: a failure here must not stop the worker.
  await ensureMeetingReconcileScheduled(tenantId).catch((err) => {
    console.error(
      `[worker] meeting-reconcile bootstrap failed for tenant ${tenantId} (worker continues):`,
      err,
    )
  })

  // Seed a one-shot recovery sweep for drafting jobs orphaned by the previous
  // instance's crash/deploy (idempotent). Best-effort: never blocks worker startup.
  await ensureStaleDraftReconcileScheduled(tenantId).catch((err) => {
    console.error(
      `[worker] stale-draft-reconcile bootstrap failed for tenant ${tenantId} (worker continues):`,
      err,
    )
  })

  // WF-FIX-1 (WP6) — same one-shot sweep for capability jobs orphaned 'running'.
  await ensureStaleCapabilityReconcileScheduled(tenantId).catch((err) => {
    console.error(
      `[worker] stale-capability-reconcile bootstrap failed for tenant ${tenantId} (worker continues):`,
      err,
    )
  })
}

startWorker().catch((error) => {
  console.error(error)
  process.exit(1)
})
