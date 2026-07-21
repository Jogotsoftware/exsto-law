// FB-H / ATTN-FIX-1 — the ATTENTION ENGINE. What matters here:
// (1) The feed is INBOUND-only: the sole item class is awaiting_reply (a client
//     sent a message and no one has replied). Firm-self-generated state (tasks,
//     drafts, envelopes, invoices, stale matters, parked workflows) was removed.
// (2) DIRECTION FILTER: only genuinely inbound client mail counts — the firm's
//     OWN ingested email (mail.ingest stamps everything 'inbound') and firm-side
//     portal replies are excluded; an outbound-last thread is not an item.
// (3) EVERY item names the actual PERSON — the sender contact, else the matter's
//     client, else the generic "A client"; never a mailbox display name/code.
// (4) RANKING is a pure, deterministic function (oldest-waiting first).
// (5) FEED ASSEMBLY honors the item + char caps with FAKE readers (no DB).
// (6) The get_attention_feed tool is registered on EVERY attorney turn; its
//     read-back cites why + deepLink honestly; the global snapshot rides the
//     VOLATILE half and ONLY on global turns; the stable prompt names the attorney.
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
  isInboundClientMessage,
  awaitingReplyDisplayName,
  matterActivityDeepLink,
  mailThreadDeepLink,
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
// function. Defaults to a PORTAL client message (author:'client'); email rows
// override author→null, direction→'inbound'|'outbound', and fromAddress. This is
// the exact shape readAwaitingReply maps its SQL rows into.
function threadRow(over: Partial<AwaitingReplyThreadRow> = {}): AwaitingReplyThreadRow {
  return {
    threadId: 'thread-1',
    matterId: 'matter-1',
    matterNumber: 'M-MRTHA103',
    gmailThreadId: null,
    channel: 'portal',
    occurredAt: daysAgo(1),
    author: 'client',
    direction: null,
    fromAddress: null,
    senderName: 'Maria Fernanda',
    matterClientName: null,
    ...over,
  }
}

// An inbound client EMAIL row (author is null on ingested mail; mail.ingest
// stamps direction 'inbound'; the From is the discriminator).
function emailRow(over: Partial<AwaitingReplyThreadRow> = {}): AwaitingReplyThreadRow {
  return threadRow({
    channel: null,
    author: null,
    direction: 'inbound',
    fromAddress: 'riley@client.example',
    senderName: 'Riley Chen',
    ...over,
  })
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
    const [it0] = buildAwaitingReplyItems([emailRow({ senderName: 'Riley Chen' })], NOW)
    expect(it0!.why).toContain('Riley Chen sent a message on M-MRTHA103')
  })

  it('falls back to "A client" only when literally no name resolved', () => {
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

describe('buildAwaitingReplyItems — direction filter (ATTN-FIX-1: inbound-only)', () => {
  // The founder bug: the firm's OWN sent mail showed as an inbound "client is
  // waiting" item, because mail.ingest stamps every synced message 'inbound'.
  it("excludes the firm's own ingested email (From = firm mailbox)", () => {
    const rows = [emailRow({ fromAddress: 'firm@pacheco.law', senderName: null })]
    expect(buildAwaitingReplyItems(rows, NOW, new Set(['firm@pacheco.law']))).toHaveLength(0)
  })

  it("matches the firm's From case-insensitively", () => {
    const rows = [emailRow({ fromAddress: 'Firm@Pacheco.Law', senderName: null })]
    expect(buildAwaitingReplyItems(rows, NOW, new Set(['firm@pacheco.law']))).toHaveLength(0)
  })

  it('keeps a genuinely inbound client email (From not the firm) and names the sender', () => {
    const rows = [emailRow({ fromAddress: 'riley@client.example', senderName: 'Riley Chen' })]
    const items = buildAwaitingReplyItems(rows, NOW, new Set(['firm@pacheco.law']))
    expect(items).toHaveLength(1)
    expect(items[0]!.why).toContain('Riley Chen sent a message on M-MRTHA103')
  })

  it('excludes an OUTBOUND-last thread (nothing pending)', () => {
    const rows = [emailRow({ direction: 'outbound', fromAddress: 'firm@pacheco.law' })]
    expect(buildAwaitingReplyItems(rows, NOW)).toHaveLength(0)
  })

  it('excludes a firm-side portal reply (author is attorney, not client)', () => {
    expect(buildAwaitingReplyItems([threadRow({ author: 'attorney' })], NOW)).toHaveLength(0)
  })
})

describe('buildAwaitingReplyItems — always names a person (ATTN-FIX-1 second half)', () => {
  it("falls back to the matter's client when the sender did not resolve — never the matter code", () => {
    const rows = [
      emailRow({
        fromAddress: 'unknown@x.test',
        senderName: null,
        matterClientName: 'Juan Carlos Pacheco',
      }),
    ]
    const [it0] = buildAwaitingReplyItems(rows, NOW)
    expect(it0!.why).toBe(
      'Juan Carlos Pacheco sent a message on M-MRTHA103 yesterday and is waiting for your reply.',
    )
    expect(it0!.title).toBe('Reply needed: Juan Carlos Pacheco')
    expect(it0!.why).not.toContain('M-MRTHA103 sent')
  })

  it('prefers the sender contact over the matter client', () => {
    const rows = [threadRow({ senderName: 'Riley Chen', matterClientName: 'Juan Carlos Pacheco' })]
    expect(buildAwaitingReplyItems(rows, NOW)[0]!.title).toBe('Reply needed: Riley Chen')
  })

  it('never renders a mailbox display name/address — a matterless unresolved thread is "A client"', () => {
    const rows = [
      emailRow({
        matterId: null,
        matterNumber: null,
        gmailThreadId: 'g-1',
        fromAddress: 'weird-alias@x.test',
        senderName: null,
        matterClientName: null,
      }),
    ]
    expect(buildAwaitingReplyItems(rows, NOW)[0]!.title).toBe('Reply needed: A client')
  })
})

describe('isInboundClientMessage — the direction predicate', () => {
  const firm = new Set(['firm@pacheco.law'])
  it('portal client post is inbound; portal attorney post is not', () => {
    expect(
      isInboundClientMessage({ author: 'client', direction: null, fromAddress: null }, firm),
    ).toBe(true)
    expect(
      isInboundClientMessage({ author: 'attorney', direction: null, fromAddress: null }, firm),
    ).toBe(false)
  })
  it('inbound email from a client is inbound; from the firm is not (case-insensitive)', () => {
    expect(
      isInboundClientMessage(
        { author: null, direction: 'inbound', fromAddress: 'riley@client.example' },
        firm,
      ),
    ).toBe(true)
    expect(
      isInboundClientMessage(
        { author: null, direction: 'inbound', fromAddress: 'firm@pacheco.law' },
        firm,
      ),
    ).toBe(false)
    expect(
      isInboundClientMessage(
        { author: null, direction: 'inbound', fromAddress: 'FIRM@PACHECO.LAW' },
        firm,
      ),
    ).toBe(false)
  })
  it('outbound email is never inbound', () => {
    expect(
      isInboundClientMessage(
        { author: null, direction: 'outbound', fromAddress: 'riley@client.example' },
        firm,
      ),
    ).toBe(false)
  })
  it('an inbound email with an unreadable From is included (we only exclude what we can prove is the firm)', () => {
    expect(
      isInboundClientMessage({ author: null, direction: 'inbound', fromAddress: null }, firm),
    ).toBe(true)
  })
})

describe('awaitingReplyDisplayName — sender, then matter client, then "A client"', () => {
  it('uses the sender contact when present', () => {
    expect(awaitingReplyDisplayName(threadRow({ senderName: 'Riley Chen' }))).toBe('Riley Chen')
  })
  it('falls back to the matter client when the sender is null/blank', () => {
    expect(
      awaitingReplyDisplayName(
        threadRow({ senderName: null, matterClientName: 'Juan Carlos Pacheco' }),
      ),
    ).toBe('Juan Carlos Pacheco')
    expect(
      awaitingReplyDisplayName(
        threadRow({ senderName: '   ', matterClientName: 'Juan Carlos Pacheco' }),
      ),
    ).toBe('Juan Carlos Pacheco')
  })
  it('falls back to "A client" when neither resolves', () => {
    expect(awaitingReplyDisplayName(threadRow({ senderName: null, matterClientName: null }))).toBe(
      'A client',
    )
  })
})

describe('buildAwaitingReplyItems — dedupe/grouping (the founder-walk duplicate)', () => {
  it('collapses two threads for the SAME sender on the SAME matter into ONE row with a count', () => {
    const rows = [
      threadRow({ threadId: 't-1', occurredAt: daysAgo(1), channel: 'portal' }),
      threadRow({ threadId: 't-2', occurredAt: daysAgo(3), channel: 'portal' }),
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

describe('awaiting-reply deep-link helpers', () => {
  it('matterActivityDeepLink points at the Activity tab', () => {
    expect(matterActivityDeepLink('matter-1')).toBe('/attorney/matters/matter-1/activity')
  })
  it('mailThreadDeepLink scopes to the thread, or falls back to the inbox', () => {
    expect(mailThreadDeepLink('g-1')).toBe('/attorney/mail?thread=g-1')
    expect(mailThreadDeepLink(null)).toBe('/attorney/mail')
  })
})

describe('rankAttentionItems — deterministic ordering (oldest-waiting first)', () => {
  const fixtures: AttentionItem[] = [
    item('awaiting_reply', daysAgo(1), { deepLink: '/a' }),
    item('awaiting_reply', daysAgo(5), { deepLink: '/b' }),
    item('awaiting_reply', daysAgo(3), { deepLink: '/c' }),
  ]

  it('orders by age — the longest-unanswered reply is most pressing', () => {
    expect(rankAttentionItems(fixtures, NOW).map((i) => i.deepLink)).toEqual(['/b', '/c', '/a'])
  })

  it('assigns a monotonic 0-based rank', () => {
    expect(rankAttentionItems(fixtures, NOW).map((i) => i.rank)).toEqual([0, 1, 2])
  })

  it('is stable under input reordering (deterministic)', () => {
    const a = rankAttentionItems(fixtures, NOW).map((i) => i.deepLink)
    const b = rankAttentionItems([...fixtures].reverse(), NOW).map((i) => i.deepLink)
    expect(a).toEqual(b)
  })

  it('breaks equal-age ties stably by kind+link', () => {
    const same = [
      item('awaiting_reply', daysAgo(2), { deepLink: '/z' }),
      item('awaiting_reply', daysAgo(2), { deepLink: '/a' }),
    ]
    const first = rankAttentionItems(same, NOW).map((i) => i.deepLink)
    const second = rankAttentionItems([...same].reverse(), NOW).map((i) => i.deepLink)
    expect(first).toEqual(second)
    expect(first[0]).toBe('/a') // localeCompare: '/a' sorts before '/z'
  })
})

// A fake reader so getAttentionFeed runs end-to-end with no DB. Overridable.
function fakeReaders(over: Partial<AttentionReaderDeps> = {}): AttentionReaderDeps {
  return {
    awaitingReplyThreads: async () => [
      item('awaiting_reply', daysAgo(1), { deepLink: '/a' }),
      item('awaiting_reply', daysAgo(5), { deepLink: '/b' }),
    ],
    ...over,
  }
}

describe('getAttentionFeed — assembly (inbound-only)', () => {
  it('returns the awaiting-reply bucket, ranked oldest-first', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders() })
    expect(feed.map((i) => i.deepLink)).toEqual(['/b', '/a'])
    expect(feed.every((i) => i.kind === 'awaiting_reply')).toBe(true)
  })

  it('honors maxItems', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders(), maxItems: 1 })
    expect(feed).toHaveLength(1)
    expect(feed[0]!.deepLink).toBe('/b')
  })

  it('honors maxChars (keeps at least one, then stops)', async () => {
    const feed = await getAttentionFeed(ctx, { now: NOW, readers: fakeReaders(), maxChars: 1 })
    expect(feed).toHaveLength(1)
  })

  it('a failing bucket is non-fatal — the feed is empty, not a crash', async () => {
    const feed = await getAttentionFeed(ctx, {
      now: NOW,
      readers: {
        awaitingReplyThreads: async () => {
          throw new Error('inbox read blew up')
        },
      },
    })
    expect(feed).toEqual([])
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
    item('awaiting_reply', daysAgo(3), { why: 'Riley Chen is waiting on your reply.' }),
  ])

  it('renderAttentionSnapshot produces one-liners with the deepLink', () => {
    expect(snap).toContain('Riley Chen is waiting on your reply.')
    expect(snap).toContain('→ /attorney/matters/awaiting_reply')
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
    expect(withSnap).toContain('Riley Chen is waiting on your reply.')
    const without = buildVolatileClaudeSystem(undefined, '', '')
    expect(without).not.toContain('What is most pressing for the attorney right now')
  })
})

describe('get_attention_feed read-back (honesty)', () => {
  it('cites each item why + deepLink', async () => {
    const tool = buildAttentionFeedTool(ctx, {
      getAttentionFeed: async () => [
        item('awaiting_reply', daysAgo(2), {
          why: 'Riley Chen is waiting on your reply.',
          deepLink: '/attorney/matters/abc/activity',
        }),
      ],
    })
    const ack = (await tool.run({})) as string
    expect(ack).toContain('Riley Chen is waiting on your reply.')
    expect(ack).toContain('/attorney/matters/abc/activity')
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
