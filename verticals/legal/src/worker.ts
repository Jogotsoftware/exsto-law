// Legal vertical worker process: the generic runtime + this vertical's
// handlers. Run via `pnpm dev:worker` (root) — node --env-file=.env.local.
import './index.js' // registers action handlers (side effect)
import './workers/index.js' // registers vertical worker handlers
import { startWorker } from '@exsto/worker-runtime'
import {
  ensureMeetingReconcileScheduled,
  ensureStaleCapabilityReconcileScheduled,
  ensureStaleDraftReconcileScheduled,
} from './workers/index.js'

const TENANT_ZERO = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

// Seed the periodic calendar reconciliation chain (idempotent — no-ops if one is
// already scheduled). Best-effort: a failure here must not stop the worker.
await ensureMeetingReconcileScheduled(TENANT_ZERO).catch((err) => {
  console.error('[worker] meeting-reconcile bootstrap failed (worker continues):', err)
})

// Seed a one-shot recovery sweep for drafting jobs orphaned by the previous
// instance's crash/deploy (idempotent). Best-effort: never blocks worker startup.
await ensureStaleDraftReconcileScheduled(TENANT_ZERO).catch((err) => {
  console.error('[worker] stale-draft-reconcile bootstrap failed (worker continues):', err)
})

// WF-FIX-1 (WP6) — same one-shot sweep for capability jobs orphaned 'running'.
await ensureStaleCapabilityReconcileScheduled(TENANT_ZERO).catch((err) => {
  console.error('[worker] stale-capability-reconcile bootstrap failed (worker continues):', err)
})

startWorker().catch((error) => {
  console.error(error)
  process.exit(1)
})
