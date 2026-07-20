// WF-FIX-1 (WP6) — stalled legal.capability.run jobs must surface as a queryable
// capability_run_stalled observation on the matter (the CapabilityStatePanel reads
// it to show an honest failed state). Parity with resolveStaleDraftJobs.
import { describe, it, expect, vi } from 'vitest'

const staleRows: Array<{ id: string; payload: Record<string, unknown> }> = []
vi.mock('@exsto/substrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/substrate')>()
  return {
    ...actual,
    submitAction: vi.fn(async () => ({ actionId: 'a', effects: [] })),
    withActionContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: staleRows, rowCount: staleRows.length }) }),
    ),
  }
})
import { submitAction } from '@exsto/substrate'
import { resolveStaleCapabilityJobs } from '@exsto/legal'

const CTX = { tenantId: '00000000-0000-0000-0000-000000000001', actorId: 'worker-actor' }

describe('resolveStaleCapabilityJobs (WF-FIX-1 WP6)', () => {
  it('records one capability_run_stalled observation per stalled job', async () => {
    staleRows.length = 0
    staleRows.push(
      { id: 'job-1', payload: { matter_entity_id: 'matter-1', stage_key: 'ai_review' } },
      { id: 'job-2', payload: {} }, // no matter id → skipped, never a blind write
    )
    const resolved = await resolveStaleCapabilityJobs(CTX)

    expect(resolved).toEqual([
      { matterEntityId: 'matter-1', jobId: 'job-1', stageKey: 'ai_review' },
    ])
    expect(submitAction).toHaveBeenCalledTimes(1)
    const call = vi.mocked(submitAction).mock.calls[0][1]
    expect(call.actionKindName).toBe('event.record')
    expect(call.payload).toMatchObject({
      event_kind_name: 'observation',
      primary_entity_id: 'matter-1',
      data: expect.objectContaining({
        kind: 'capability_run_stalled',
        stage: 'ai_review',
        job_id: 'job-1',
        retryable: true,
      }),
    })
  })
})
