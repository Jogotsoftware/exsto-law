import type { ActionContext } from '@exsto/substrate'
import { registerWorkerHandler } from './registry.js'

export interface SampleJobPayload {
  message?: string
}

// Reference handler proving the runtime end-to-end. Real handlers (ingestion,
// identity resolution, notification dispatch, scheduled re-projection) follow
// the same shape and register themselves on import.
export async function handleSampleJob(
  ctx: ActionContext,
  payload: SampleJobPayload,
): Promise<void> {
  console.log(
    `worker.sample tenant=${ctx.tenantId} actor=${ctx.actorId} message=${payload.message ?? '(none)'}`,
  )
}

registerWorkerHandler('sample', (ctx, payload) => handleSampleJob(ctx, payload as SampleJobPayload))
