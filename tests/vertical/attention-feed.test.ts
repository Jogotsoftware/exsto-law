// FB-H — the ATTENTION ENGINE. What matters here:
// (1) RANKING is a pure, deterministic function — overdue first, then
//     awaiting-reply, then the slipped-cracks band by age, then due-soon; equal
//     inputs always sort the same way regardless of input order.
// (2) FEED ASSEMBLY concatenates every bucket, dedupes the stale/parked overlap,
//     and honors the item + char caps — all with FAKE readers (no DB, no model).
// (3) The get_attention_feed tool is registered on EVERY attorney turn (global
//     included) and its read-back cites the why + deepLink honestly.
// (4) The global-scope snapshot rides the VOLATILE half and ONLY on global turns.
// (5) The stable prompt names the attorney it serves.
import { describe, it, expect } from 'vitest'
import {
  rankAttentionItems,
  getAttentionFeed,
  renderAttentionSnapshot,
  renderAttentionLine,
  buildAttentionFeedTool,
  attentionSnapshotForScope,
  buildAttorneyClientTools,
  buildVolatileClaudeSystem,
  buildBaseSystemPrompt,
  type AttentionItem,
  type AttentionReaderDeps,
  type AssistantChatInput,
  type AssistantFirmFacts,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

// A fixed clock so ages (and therefore rank tiebreaks) are deterministic.
const NOW = Date.parse('2026-07-20T12:00:00.000Z')
const daysAgo = (n: number): string => new Date(NOW - n * 86_400_000).toISOString()

function item(
  kind: AttentionItem['kind'],
  occurredAt: string,
  over: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    kind,
    title: `${kind} title`,
    why: `${kind} reason`,
    deepLink: over.deepLink ?? `/attorney/matters/${kind}`,
    rank: 0,
    occurredAt,
    ...over,
  }
}

describe('rankAttentionItems — deterministic ordering', () => {
  // One fixture per bucket, ages chosen so the tier order and the by-age
  // tiebreak within the slipped-cracks band are both exercised.
  const fixtures: AttentionItem[] = [
    item('due_soon_task', daysAgo(-2)), // due in 2 days (future)
    item('stale_matter', daysAgo(9), { entityId: 'm-stale' }),
    item('invoice_unpaid', daysAgo(20)),
    item('overdue_task', daysAgo(4)),
    item('envelope_unsigned', daysAgo(30)), // oldest in the band
    item('awaiting_reply', daysAgo(1)),
    item('draft_pending_review', daysAgo(6)),
    item('workflow_parked', daysAgo(12), { entityId: 'm-parked' }),
  ]

  it('orders by tier: overdue → awaiting-reply → review → (unsigned/unpaid/parked/stale by age) → due-soon', () => {
    const ranked = rankAttentionItems(fixtures, NOW).map((i) => i.kind)
    expect(ranked).toEqual([
      'overdue_task',
      'awaiting_reply',
      'draft_pending_review',
      // Same tier (3), oldest first: envelope(30d) > invoice(20d) > parked(12d) > stale(9d).
      'envelope_unsigned',
      'invoice_unpaid',
      'workflow_parked',
      'stale_matter',
      'due_soon_task',
    ])
  })

  it('assigns a monotonic 0-based rank', () => {
    const ranked = rankAttentionItems(fixtures, NOW)
    expect(ranked.map((i) => i.rank)).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })

  it('is stable under input reordering (deterministic)', () => {
    const a = rankAttentionItems(fixtures, NOW).map((i) => i.kind)
    const b = rankAttentionItems([...fixtures].reverse(), NOW).map((i) => i.kind)
    expect(a).toEqual(b)
  })

  it('breaks equal-tier equal-age ties stably by kind+link', () => {
    const same = [
      item('invoice_unpaid', daysAgo(15), { deepLink: '/attorney/billing' }),
      item('envelope_unsigned', daysAgo(15), { deepLink: '/attorney/esign' }),
    ]
    const first = rankAttentionItems(same, NOW).map((i) => i.kind)
    const second = rankAttentionItems([...same].reverse(), NOW).map((i) => i.kind)
    expect(first).toEqual(second)
    // envelope_unsigned sorts before invoice_unpaid (same tier, same age → kind order).
    expect(first[0]).toBe('envelope_unsigned')
  })
})

// A full set of fake readers, each yielding one item, so getAttentionFeed runs
// end-to-end with no DB. Overridable per test.
function fakeReaders(over: Partial<AttentionReaderDeps> = {}): AttentionReaderDeps {
  return {
    overdueAndDueSoonTasks: async () => [item('overdue_task', daysAgo(3))],
    awaitingReplyThreads: async () => [item('awaiting_reply', daysAgo(1))],
    pendingReviewDrafts: async () => [item('draft_pending_review', daysAgo(5))],
    unsignedEnvelopes: async () => [item('envelope_unsigned', daysAgo(9))],
    unpaidInvoices: async () => [item('invoice_unpaid', daysAgo(20))],
    staleMatters: async () => [item('stale_matter', daysAgo(10), { entityId: 'm1' })],
    parkedWorkflows: async () => [item('workflow_parked', daysAgo(11), { entityId: 'm2' })],
    ...over,
  }
}

describe('getAttentionFeed — assembly', () => {
  it('concatenates every bucket and ranks them', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders() })
    expect(feed.map((i) => i.kind)).toEqual([
      'overdue_task',
      'awaiting_reply',
      'draft_pending_review',
      'invoice_unpaid', // 20d
      'workflow_parked', // 11d
      'stale_matter', // 10d
      'envelope_unsigned', // 9d
    ])
  })

  it('dedupes a stale matter that is also a parked workflow (parked wins)', async () => {
    const feed = await getAttentionFeed(ctx, {
      now: NOW,
      readers: fakeReaders({
        staleMatters: async () => [item('stale_matter', daysAgo(10), { entityId: 'shared' })],
        parkedWorkflows: async () => [item('workflow_parked', daysAgo(11), { entityId: 'shared' })],
      }),
    })
    const shared = feed.filter((i) => i.entityId === 'shared')
    expect(shared).toHaveLength(1)
    expect(shared[0]!.kind).toBe('workflow_parked')
  })

  it('honors maxItems', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders(), maxItems: 3 })
    expect(feed).toHaveLength(3)
    expect(feed[0]!.kind).toBe('overdue_task')
  })

  it('honors maxChars (keeps at least one, then stops)', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders(), maxChars: 1 })
    expect(feed).toHaveLength(1)
  })

  it('a failing bucket is non-fatal — the rest of the feed still assembles', async () => {
    const feed = await getAttentionFeed(ctx, {
      now: NOW,
      readers: fakeReaders({
        unpaidInvoices: async () => {
          throw new Error('billing read blew up')
        },
      }),
    })
    expect(feed.some((i) => i.kind === 'invoice_unpaid')).toBe(false)
    expect(feed.some((i) => i.kind === 'overdue_task')).toBe(true)
  })
})

describe('get_attention_feed tool registration (matrix extension)', () => {
  function emptyCapture(): Parameters<typeof buildAttorneyClientTools>[2] {
    return {
      catalog: [{ slug: 's', name: 'Skill' }],
      producedDocuments: [],
      workflowProposals: [],
      failedWorkflowAttempts: [],
      serviceProposals: [],
      questionnaireProposals: [],
      templateProposals: [],
      costProposals: [],
      enableProposals: [],
      buildQuestions: [],
      kindProposals: [],
      editorLaunches: [],
      emailComposes: [],
      envelopePrepares: [],
    }
  }
  const names = (input: AssistantChatInput): string[] =>
    buildAttorneyClientTools(ctx, input, emptyCapture()).map((t) => t.name)

  it('is registered on a GLOBAL (unscoped) turn', () => {
    expect(names({ message: "what's pressing?", modelId: 'a' })).toContain('get_attention_feed')
  })
  it('is registered on a matter-scoped turn', () => {
    expect(
      names({ message: 'x', modelId: 'a', matterEntityId: '00000000-0000-0000-0002-000000000003' }),
    ).toContain('get_attention_feed')
  })
  it('is registered even when context is off', () => {
    expect(names({ message: 'x', modelId: 'a', useContext: false })).toContain('get_attention_feed')
  })
})

describe('global-scope volatile snapshot', () => {
  const snap = renderAttentionSnapshot([
    item('overdue_task', daysAgo(3), { why: 'The task "file annual report" is overdue.' }),
  ])

  it('renderAttentionSnapshot produces one-liners with the deepLink', () => {
    expect(snap).toContain('file annual report')
    expect(snap).toContain('→ /attorney/matters/overdue_task')
    expect(renderAttentionSnapshot([])).toBe('')
  })

  it('attentionSnapshotForScope passes it through on global only', () => {
    expect(attentionSnapshotForScope('global', snap)).toBe(snap)
    expect(attentionSnapshotForScope('matter', snap)).toBe('')
    expect(attentionSnapshotForScope('contact', snap)).toBe('')
  })

  it('buildVolatileClaudeSystem injects the snapshot block only when given one', () => {
    const withSnap = buildVolatileClaudeSystem(undefined, '', snap)
    expect(withSnap).toContain('What is most pressing for the attorney right now')
    expect(withSnap).toContain('file annual report')
    const without = buildVolatileClaudeSystem(undefined, '', '')
    expect(without).not.toContain('What is most pressing for the attorney right now')
  })
})

describe('get_attention_feed read-back (honesty)', () => {
  it('cites each item why + deepLink', async () => {
    const tool = buildAttentionFeedTool(ctx, {
      getAttentionFeed: async () => [
        item('overdue_task', daysAgo(2), {
          why: 'The task "file annual report" is overdue.',
          deepLink: '/attorney/matters/abc',
        }),
      ],
    })
    const ack = (await tool.run({})) as string
    expect(ack).toContain('file annual report')
    expect(ack).toContain('/attorney/matters/abc')
  })

  it('says plainly when nothing is pressing (never invents)', async () => {
    const tool = buildAttentionFeedTool(ctx, { getAttentionFeed: async () => [] })
    const ack = (await tool.run({})) as string
    expect(ack.toLowerCase()).toContain('nothing is pressing')
    expect(ack).toContain('do not invent')
  })

  it('renderAttentionLine is the shared line shape', () => {
    const line = renderAttentionLine(
      item('awaiting_reply', daysAgo(1), { why: 'Riley is waiting.' }),
    )
    expect(line).toBe('- Riley is waiting. → /attorney/matters/awaiting_reply')
  })
})

describe('attorney identity in the stable prompt', () => {
  it('names the attorney when a name is on file', () => {
    const firm: AssistantFirmFacts = { firmName: 'Test Firm', attorneyName: 'Juan Carlos Pacheco' }
    const prompt = buildBaseSystemPrompt(firm)
    expect(prompt).toContain('You are working with Juan Carlos Pacheco')
    // The identity line points at the attention engine as the task-manager path.
    expect(prompt).toContain('get_attention_feed')
  })

  it('is silent (no placeholder) when no name is known', () => {
    const prompt = buildBaseSystemPrompt({ firmName: 'Test Firm' })
    expect(prompt).not.toContain('You are working with')
    // No double space left behind by the omitted line.
    expect(prompt).not.toContain('  ')
  })
})
