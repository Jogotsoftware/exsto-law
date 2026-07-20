// WF-FIX-1 (WP3) — a review_send_document stage that CARRIES a document annotation
// is a producing stage: entry enqueues the legal.draft.run job so the attorney opens
// the review with the draft already there. A bare review step must stay non-producing.
// The DB-backed leg (worker drafts from the annotated template, matter parks at
// review) is proven by the sandbox acceptance harness; here the registry dispatch and
// the payload the worker receives are pinned without a DB.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@exsto/worker-runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/worker-runtime')>()
  return { ...actual, enqueueJob: vi.fn(async () => 'job-1') }
})
vi.mock('@exsto/substrate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exsto/substrate')>()
  return {
    ...actual,
    submitAction: vi.fn(async () => ({ actionId: 'a', effects: [] })),
    // WF-FIX-1 (WP5): the enqueue path resolves the tenant's own agent actor first
    // (tenantActors.resolveTenantAgentCtx) — answer that lookup without a DB.
    withActionContext: vi.fn(async (_ctx: unknown, fn: (client: unknown) => Promise<unknown>) =>
      fn({ query: async () => ({ rows: [{ id: 'tenant-agent-actor' }], rowCount: 1 }) }),
    ),
  }
})
import { enqueueJob } from '@exsto/worker-runtime'
import {
  scheduleProducingAutoRun,
  resolveStageTemplateRef,
  type Lifecycle,
  type LifecycleStage,
} from '@exsto/legal'

const TENANT = '00000000-0000-0000-00fe-000000000001'

const annotatedReview: LifecycleStage = {
  key: 'review_send_oa',
  label: 'Review & send operating agreement',
  action: { kind: 'review_send_document' },
  documents: [
    { templateEntityId: 'tmpl-oa-1', docKind: 'operating_agreement', label: 'Operating agreement' },
  ],
  advances_to: [{ to: 'signed', gate: 'client', via: 'legal.client_request.accept' }],
}

const bareReview: LifecycleStage = {
  key: 'review_plain',
  label: 'Review the uploaded contract',
  action: { kind: 'review_send_document' },
  advances_to: [{ to: 'done', gate: 'attorney', via: 'draft.approve' }],
}

const GRAPH: Lifecycle = [
  annotatedReview,
  bareReview,
  { key: 'signed', label: 'Signed', advances_to: [] },
  { key: 'done', label: 'Done', terminal: true, advances_to: [] },
]

describe('review_send_document producing auto-run (WF-FIX-1 WP3)', () => {
  beforeEach(() => {
    vi.mocked(enqueueJob).mockClear()
  })

  it('an annotated review stage schedules a draft enqueue on entry', async () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun(
      { tenantId: TENANT, actorId: 'actor-1', afterCommit },
      'matter-1',
      'review_send_oa',
      GRAPH,
    )
    expect(afterCommit).toHaveLength(1)

    await afterCommit[0]()
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    const call = vi.mocked(enqueueJob).mock.calls[0][0]
    expect(call.jobKind).toBe('legal.draft.run')
    expect(call.payload).toMatchObject({
      matter_entity_id: 'matter-1',
      document_kind: 'operating_agreement',
      producing_autorun: true,
      // The stage's annotated template rides the payload — the worker drafts from
      // THAT template, not a same-kind library default.
      template_entity_id: 'tmpl-oa-1',
    })
  })

  it('a bare review stage (no documents) stays non-producing', () => {
    const afterCommit: Array<() => Promise<void>> = []
    scheduleProducingAutoRun(
      { tenantId: TENANT, actorId: 'actor-1', afterCommit },
      'matter-1',
      'review_plain',
      GRAPH,
    )
    expect(afterCommit).toHaveLength(0)
  })

  it('resolveStageTemplateRef finds the first template annotation and tolerates none', () => {
    expect(resolveStageTemplateRef(annotatedReview)).toBe('tmpl-oa-1')
    expect(resolveStageTemplateRef(bareReview)).toBeNull()
    expect(
      resolveStageTemplateRef({
        ...bareReview,
        documents: [{ docKind: 'nda' }, { templateEntityId: ' tmpl-2 ' }],
      }),
    ).toBe(' tmpl-2 ')
  })
})
