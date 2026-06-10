import type { ActionContext } from '@exsto/substrate'

export type WorkerHandler = (ctx: ActionContext, payload: Record<string, unknown>) => Promise<void>

const handlers = new Map<string, WorkerHandler>()

// Register a handler for a job kind. New handlers are code drops; the runtime
// does not change (DoD: "a handler can be registered without changing the runtime").
export function registerWorkerHandler(jobKind: string, handler: WorkerHandler): void {
  handlers.set(jobKind, handler)
}

export function getWorkerHandler(jobKind: string): WorkerHandler | undefined {
  return handlers.get(jobKind)
}

export function clearWorkerHandlers(): void {
  handlers.clear()
}
