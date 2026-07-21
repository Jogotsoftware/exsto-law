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
  buildAwaitingReplyItems,
  taskDeepLink,
  matterActivityDeepLink,
  mailThreadDeepLink,
  draftDeepLink,
  envelopeDeepLink,
  invoiceDeepLink,
  type AttentionItem,
  type AttentionReaderDeps,
  type AssistantChatInput,
  type AssistantFirmFacts,
  type AwaitingReplyThreadRow,
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

// A fixture thread row for buildAwaitingReplyItems — the pure grouping+copy
// function that fixes founder walk 15.9 (fake matter-as-sender copy,
// pixel-identical duplicate rows, dead links). No DB: this is the exact shape
// readAwaitingReply maps its SQL rows into.
function threadRow(over: Partial<AwaitingReplyThreadRow> = {}): AwaitingReplyThreadRow {
  return {
    threadId: 'thread-1',
    matterId: 'matter-1',
    matterNumber: 'M-MRTHA103',
    gmailThreadId: null,
    channel: 'portal',
    occurredAt: daysAgo(1),
    senderName: 'Maria Fernanda',
    ...over,
  }
}

describe('buildAwaitingReplyItems — sender+matter copy (founder walk 15.9)', () => {
  it('names the real SENDER, not the matter — matters do not send messages', () => {
    const [it0] = buildAwaitingReplyItems([threadRow()], NOW)
    expect(it0!.why).toBe(
      'Maria Fernanda sent a portal message on M-MRTHA103 yesterday and is waiting for your reply.',
    )
    expect(it0!.title).toBe('Reply needed: Maria Fernanda')
    // The old bug: "M-MRTHA103 sent a message…" — the matter as the subject.
    expect(it0!.why).not.toMatch(/^M-MRTHA103 sent/)
  })

  it('says "a message" (not "a portal message") for an email-channel thread', () => {
    const [it0] = buildAwaitingReplyItems(
      [threadRow({ channel: null, senderName: 'Riley Chen' })],
      NOW,
    )
    expect(it0!.why).toContain('Riley Chen sent a message on M-MRTHA103')
  })

  it('falls back to "A client" only when literally no sender name resolved', () => {
    const [it0] = buildAwaitingReplyItems([threadRow({ senderName: null })], NOW)
    expect(it0!.why).toContain('A client sent')
  })

  it('omits the matter clause when the thread has no linked matter', () => {
    const [it0] = buildAwaitingReplyItems(
      [threadRow({ matterId: null, matterNumber: null, gmailThreadId: 'g-1' })],
      NOW,
    )
    expect(it0!.why).toBe(
      'Maria Fernanda sent a portal message yesterday and is waiting for your reply.',
    )
  })
})

describe('buildAwaitingReplyItems — dedupe/grouping (the founder-walk duplicate)', () => {
  it('collapses two threads for the SAME sender on the SAME matter into ONE row with a count', () => {
    // This is exactly the founder-walk symptom: two threads (e.g. a portal
    // message and a separate email) on one matter, both from the same
    // person — the old code showed two pixel-identical "M-… sent a message"
    // rows because the copy only named the matter.
    const rows = [
      threadRow({ threadId: 't-1', occurredAt: daysAgo(1), channel: 'portal' }),
      threadRow({ threadId: 't-2', occurredAt: daysAgo(3), channel: null }),
    ]
    const items = buildAwaitingReplyItems(rows, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]!.why).toContain('Maria Fernanda sent 2 messages on M-MRTHA103')
    // Age reflects the LONGER wait (the oldest unanswered thread), not the newest.
    expect(items[0]!.why).toContain('3 days ago')
    expect(items[0]!.occurredAt).toBe(daysAgo(3))
  })

  it('does NOT merge two different senders on the same matter', () => {
    const rows = [
      threadRow({ threadId: 't-1', senderName: 'Maria Fernanda' }),
      threadRow({ threadId: 't-2', senderName: 'Carlos Ruiz' }),
    ]
    const items = buildAwaitingReplyItems(rows, NOW)
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.title).sort()).toEqual([
      'Reply needed: Carlos Ruiz',
      'Reply needed: Maria Fernanda',
    ])
  })

  it('does NOT merge two matter-less threads from the same sender (grouped by thread instead)', () => {
    const rows = [
      threadRow({ threadId: 't-1', matterId: null, matterNumber: null, gmailThreadId: 'g-1' }),
      threadRow({ threadId: 't-2', matterId: null, matterNumber: null, gmailThreadId: 'g-2' }),
    ]
    const items = buildAwaitingReplyItems(rows, NOW)
    expect(items).toHaveLength(2)
  })

  it('sender-name matching is case-insensitive (same person, different casing)', () => {
    const rows = [
      threadRow({ threadId: 't-1', senderName: 'Maria Fernanda' }),
      threadRow({ threadId: 't-2', senderName: 'MARIA FERNANDA' }),
    ]
    expect(buildAwaitingReplyItems(rows, NOW)).toHaveLength(1)
  })
})

describe('buildAwaitingReplyItems — deep links (real subject, not a generic page)', () => {
  it('links to the matter Activity tab when a matter is known — shows BOTH portal + email threads', () => {
    const [it0] = buildAwaitingReplyItems([threadRow({ matterId: 'm-42' })], NOW)
    expect(it0!.deepLink).toBe('/attorney/matters/m-42/activity')
    expect(it0!.entityId).toBe('m-42')
  })

  it('links to the firm inbox scoped to the Gmail thread when there is no matter', () => {
    const [it0] = buildAwaitingReplyItems(
      [threadRow({ matterId: null, matterNumber: null, gmailThreadId: 'gmail-abc' })],
      NOW,
    )
    expect(it0!.deepLink).toBe('/attorney/mail?thread=gmail-abc')
    expect(it0!.entityId).toBeUndefined()
  })

  it('falls back to the bare inbox when there is neither a matter nor a Gmail thread id', () => {
    const [it0] = buildAwaitingReplyItems(
      [threadRow({ matterId: null, matterNumber: null, gmailThreadId: null })],
      NOW,
    )
    expect(it0!.deepLink).toBe('/attorney/mail')
  })
})

describe('per-item-type deep links (founder walk 15.9, bullet 1: click straight to the subject)', () => {
  it('taskDeepLink points at the task itself, not the matter overview', () => {
    expect(taskDeepLink('matter-1', 'task-9')).toBe('/attorney/matters/matter-1/tasks/task-9')
  })
  it('matterActivityDeepLink points at the Activity tab', () => {
    expect(matterActivityDeepLink('matter-1')).toBe('/attorney/matters/matter-1/activity')
  })
  it('mailThreadDeepLink scopes to the thread, or falls back to the inbox', () => {
    expect(mailThreadDeepLink('g-1')).toBe('/attorney/mail?thread=g-1')
    expect(mailThreadDeepLink(null)).toBe('/attorney/mail')
  })
  it('draftDeepLink points at the specific draft review page', () => {
    expect(draftDeepLink('version-7')).toBe('/attorney/review/version-7')
  })
  it('envelopeDeepLink points at the specific envelope', () => {
    expect(envelopeDeepLink('env-3')).toBe('/attorney/esign/env-3')
  })
  it('invoiceDeepLink opens the Invoices tab on the specific invoice', () => {
    expect(invoiceDeepLink('inv-5')).toBe('/attorney/billing?tab=invoices&invoiceId=inv-5')
  })
})

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
