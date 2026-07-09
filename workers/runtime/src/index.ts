import { randomUUID } from 'crypto'
import { closeDbPool, startTracing } from '@exsto/shared'
import { dispatchNextJob } from './dispatcher.js'
import { sweepStaleRunningJobs } from './queue.js'

export * from './queue.js'
export * from './telemetry.js'
// Liveness detection lives here but is run ONLY by the external Netlify scheduled
// function (see liveness.ts) — never by the poll loop below. A dead worker can't
// report its own death.
export * from './liveness.js'
export {
  registerWorkerHandler,
  getWorkerHandler,
  clearWorkerHandlers,
  type WorkerHandler,
} from './handlers/index.js'

const IDLE_POLL_MS = Number(process.env.WORKER_IDLE_POLL_MS ?? 1000)

// Lock-timeout sweep cadence + threshold. The threshold must exceed the longest
// real job so the sweep never reclaims one the worker is still running (which
// would double-execute it): 30m matches resolveStaleDraftJobs' stale window and
// sits well above any model-drafting job. Sweep every minute, independent of
// queue traffic.
const SWEEP_INTERVAL_MS = Number(process.env.WORKER_SWEEP_INTERVAL_MS ?? 60_000)
const LOCK_TIMEOUT_SEC = Number(process.env.WORKER_LOCK_TIMEOUT_SEC ?? 1800)

let running = false

// Poll loop: drain ready jobs back-to-back, sleep IDLE_POLL_MS when the queue
// is empty. Each dispatchNextJob claims + runs one job under its tenant context.
// Between drains, a self-throttled lock-timeout sweep reclaims jobs stranded in
// 'running' by an earlier crash (lastSweepAt=0 → one runs immediately at boot).
export async function startWorker(): Promise<void> {
  await startTracing('exsto-worker')
  const workerId = `worker-${randomUUID().slice(0, 8)}`
  running = true
  console.log(`Worker runtime starting (${workerId}).`)

  let lastSweepAt = 0
  while (running) {
    const now = Date.now()
    if (now - lastSweepAt >= SWEEP_INTERVAL_MS) {
      lastSweepAt = now
      try {
        const swept = await sweepStaleRunningJobs(LOCK_TIMEOUT_SEC)
        if (swept.reclaimed || swept.deadLettered) {
          console.warn(
            `[worker] lock-timeout sweep reclaimed ${swept.reclaimed}, dead-lettered ${swept.deadLettered} stale job(s).`,
          )
        }
      } catch (error) {
        console.error('[worker] lock-timeout sweep failed (worker continues):', error)
      }
    }

    let didWork = false
    try {
      didWork = await dispatchNextJob(workerId)
    } catch (error) {
      console.error('Worker loop error:', error)
    }
    if (!didWork) {
      await new Promise((resolve) => setTimeout(resolve, IDLE_POLL_MS))
    }
  }
}

export function stopWorker(): void {
  running = false
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  const shutdown = async () => {
    stopWorker()
    await closeDbPool()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  startWorker().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
