import { randomUUID } from 'crypto'
import { closeDbPool, startTracing } from '@exsto/shared'
import { dispatchNextJob } from './dispatcher.js'

export * from './queue.js'
export * from './telemetry.js'
export {
  registerWorkerHandler,
  getWorkerHandler,
  clearWorkerHandlers,
  type WorkerHandler,
} from './handlers/index.js'

const IDLE_POLL_MS = Number(process.env.WORKER_IDLE_POLL_MS ?? 1000)

let running = false

// Poll loop: drain ready jobs back-to-back, sleep IDLE_POLL_MS when the queue
// is empty. Each dispatchNextJob claims + runs one job under its tenant context.
export async function startWorker(): Promise<void> {
  await startTracing('exsto-worker')
  const workerId = `worker-${randomUUID().slice(0, 8)}`
  running = true
  console.log(`Worker runtime starting (${workerId}).`)

  while (running) {
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
