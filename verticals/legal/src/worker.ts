// Legal vertical worker process: the generic runtime + this vertical's
// handlers. Run via `pnpm dev:worker` (root) — node --env-file=.env.local.
import './index.js' // registers action handlers (side effect)
import './workers/index.js' // registers vertical worker handlers
import { startWorker } from '@exsto/worker-runtime'
import { ensureMeetingReconcileScheduled } from './workers/index.js'

const TENANT_ZERO = process.env.LEGAL_CLIENT_TENANT_ID ?? '00000000-0000-0000-0000-000000000001'

// Seed the periodic calendar reconciliation chain (idempotent — no-ops if one is
// already scheduled). Best-effort: a failure here must not stop the worker.
await ensureMeetingReconcileScheduled(TENANT_ZERO).catch((err) => {
  console.error('[worker] meeting-reconcile bootstrap failed (worker continues):', err)
})

startWorker().catch((error) => {
  console.error(error)
  process.exit(1)
})
