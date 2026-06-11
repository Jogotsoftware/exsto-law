// Legal vertical worker process: the generic runtime + this vertical's
// handlers. Run via `pnpm dev:worker` (root) — node --env-file=.env.local.
import './index.js' // registers action handlers (side effect)
import './workers/index.js' // registers vertical worker handlers
import { startWorker } from '@exsto/worker-runtime'

startWorker().catch((error) => {
  console.error(error)
  process.exit(1)
})
