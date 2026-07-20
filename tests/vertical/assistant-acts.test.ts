// ASSISTANT-ACTS-1 — the act-in-place chat surface. Two properties matter:
// (1) SCOPING — compose_email exists only on scoped turns (matter/contact) and
// prepare_envelope only on matter turns, so the model can never compose into a
// void; a context-off or global chat is byte-for-byte unchanged. (2) HONESTY —
// the compose tool's ack (what the model reads back) must steer it away from
// ever claiming the email was sent or queued; the attorney sends from the
// composer. Pure like build-wizard-dormancy.test.ts: tool construction is lazy
// (run() deferred), buildClaudeSystem is string building — no DB, no model.
import { describe, it, expect } from 'vitest'
import {
  buildAttorneyClientTools,
  buildClaudeSystem,
  buildComposeEmailTool,
  buildGetBriefTool,
  type AssistantChatInput,
  type AssistantFirmFacts,
  type ClientBriefReadResult,
  type EmailComposeCapture,
  type GetBriefToolDeps,
  type MatterBriefReadResult,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

// WP A2 — buildClaudeSystem now takes the firm's own facts instead of
// hardcoding Pacheco Law/NC. This suite is about act-in-place scoping, not
// jurisdiction content, so a minimal stand-in firm.
const TEST_FIRM: AssistantFirmFacts = { firmName: 'Test Firm' }

// The empty capture buckets buildAttorneyClientTools needs — none are written by
// mere construction (the tools only push on run()), so they stay empty here.
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

function toolNames(input: AssistantChatInput): string[] {
  return buildAttorneyClientTools(ctx, input, emptyCapture()).map((t) => t.name)
}

const MATTER_ID = '00000000-0000-0000-0002-000000000003'
const CONTACT_ID = '00000000-0000-0000-0002-000000000004'

describe('act-in-place tool scoping', () => {
  it('registers compose_email + get_brief + prepare_envelope on a matter-scoped turn', () => {
    const names = toolNames({
      message: 'email the client',
      modelId: 'a',
      matterEntityId: MATTER_ID,
    })
    expect(names).toContain('compose_email')
    expect(names).toContain('get_brief')
    expect(names).toContain('prepare_envelope')
  })

  it('registers compose_email + get_brief but NOT prepare_envelope on a contact-scoped turn', () => {
    const names = toolNames({
      message: 'email the client',
      modelId: 'a',
      contactEntityId: CONTACT_ID,
    })
    expect(names).toContain('compose_email')
    expect(names).toContain('get_brief')
    // Envelopes resolve against a matter's documents; a contact scope has none.
    expect(names).not.toContain('prepare_envelope')
  })

  it('registers NEITHER on a global (unscoped) turn', () => {
    const names = toolNames({ message: 'email the client', modelId: 'a' })
    expect(names).not.toContain('compose_email')
    expect(names).not.toContain('get_brief')
    expect(names).not.toContain('prepare_envelope')
  })

  it('registers NEITHER when the attorney turned context off (useContext: false)', () => {
    const names = toolNames({
      message: 'email the client',
      modelId: 'a',
      matterEntityId: MATTER_ID,
      useContext: false,
    })
    expect(names).not.toContain('compose_email')
    expect(names).not.toContain('get_brief')
    expect(names).not.toContain('prepare_envelope')
  })
})

describe('compose_email capture behavior', () => {
  it('captures a valid draft and acks with the no-sent-claim discipline', async () => {
    const captured: EmailComposeCapture[] = []
    const tool = buildComposeEmailTool(captured)
    const ack = (await tool.run({
      subject: 'Please send your lease documents',
      body_markdown: 'Dear Riley,\n\nPlease send the lease.',
      attach_document_titles: ['Engagement Letter'],
    })) as string
    expect(captured).toHaveLength(1)
    expect(captured[0]!.subject).toBe('Please send your lease documents')
    expect(captured[0]!.attachDocumentTitles).toEqual(['Engagement Letter'])
    // The ack steers the model: point to the composer, never claim sent/queued.
    expect(ack).toContain('do NOT')
    expect(ack.toLowerCase()).not.toMatch(/email (was|has been) sent/)
    expect(ack.toLowerCase()).not.toContain('review queue')
  })

  it('captures nothing when the body is empty', async () => {
    const captured: EmailComposeCapture[] = []
    const tool = buildComposeEmailTool(captured)
    await tool.run({ subject: 'Hi', body_markdown: '   ' })
    expect(captured).toHaveLength(0)
  })

  it('drops non-string attachment titles instead of failing', async () => {
    const captured: EmailComposeCapture[] = []
    const tool = buildComposeEmailTool(captured)
    await tool.run({
      subject: 'Hi',
      body_markdown: 'Body.',
      attach_document_titles: ['Real Doc', 42, null, '  '],
    })
    expect(captured[0]!.attachDocumentTitles).toEqual(['Real Doc'])
  })
})

describe('act-in-place system-prompt blocks', () => {
  it('teaches composing + brief + signature on a matter scope', () => {
    const system = buildClaudeSystem('matter', MATTER_ID, null, TEST_FIRM)
    expect(system).toContain('COMPOSING CLIENT EMAILS')
    expect(system).toContain('USING THE BRIEF')
    expect(system).toContain('SENDING FOR SIGNATURE')
    // The honesty rule rides the block: the composer is the review.
    expect(system).toContain("NEVER say the email 'will go to the review queue'")
    // get_brief doctrine: background/cite, never a substitute for generation.
    expect(system).toContain('get_brief')
    expect(system).toContain('never paste it wholesale')
  })

  it('teaches composing + brief but not signature on a contact scope', () => {
    const system = buildClaudeSystem('contact', CONTACT_ID, null, TEST_FIRM)
    expect(system).toContain('COMPOSING CLIENT EMAILS')
    expect(system).toContain('USING THE BRIEF')
    expect(system).not.toContain('SENDING FOR SIGNATURE')
  })

  it('teaches neither on a global scope (dormancy)', () => {
    const system = buildClaudeSystem('global', null, null, TEST_FIRM)
    expect(system).not.toContain('COMPOSING CLIENT EMAILS')
    expect(system).not.toContain('USING THE BRIEF')
    expect(system).not.toContain('SENDING FOR SIGNATURE')
    expect(system).not.toContain('compose_email')
    expect(system).not.toContain('get_brief')
    expect(system).not.toContain('prepare_envelope')
  })
})

// WP B5 — get_brief run() shapes: present / absent / stale, plus the
// contact→client resolution step, all pinned with plain fakes (no DB, no
// model), the same seam MatterBriefEngineDeps/ClientBriefEngineDeps use.
describe('get_brief tool', () => {
  const ctx: ActionContext = {
    tenantId: '00000000-0000-0000-0000-000000000001',
    actorId: '00000000-0000-0000-0001-000000000002',
  }
  const CLIENT_ID = '00000000-0000-0000-0002-000000000005'

  function fakeDeps(overrides: Partial<GetBriefToolDeps> = {}): GetBriefToolDeps {
    return {
      getMatterBrief: async (): Promise<MatterBriefReadResult> => ({
        brief: null,
        stale: false,
        watermark: null,
      }),
      getClientBrief: async (): Promise<ClientBriefReadResult> => ({
        brief: null,
        stale: false,
        watermark: null,
      }),
      resolveClientForContact: async () => null,
      ...overrides,
    }
  }

  it('matter scope: returns the stored brief markdown + generatedAt when present and fresh', async () => {
    const tool = buildGetBriefTool(
      ctx,
      { matterEntityId: MATTER_ID },
      fakeDeps({
        getMatterBrief: async () => ({
          brief: {
            briefEntityId: 'b1',
            briefType: 'matter',
            markdown: 'The matter is on track.',
            sections: [],
            generatedAt: '2026-07-01T00:00:00.000Z',
            modelIdentity: 'claude-x',
            confidence: 0.8,
            sourceWatermark: '2026-07-01T00:00:00.000Z',
          },
          stale: false,
          watermark: '2026-07-01T00:00:00.000Z',
        }),
      }),
    )
    const ack = await tool.run({})
    expect(ack).toContain('The matter is on track.')
    expect(ack).toContain('2026-07-01T00:00:00.000Z')
    expect(ack).not.toContain('OUT OF DATE')
  })

  it('matter scope: honestly reports absence and points to the Brief button, never claiming to generate', async () => {
    const tool = buildGetBriefTool(ctx, { matterEntityId: MATTER_ID }, fakeDeps())
    const ack = await tool.run({})
    expect(ack).toContain('No brief has been generated')
    expect(ack).toContain('Brief button')
    expect(ack).toContain('do not claim to have generated it yourself')
  })

  it('matter scope: flags staleness without hiding the (still useful) stored content', async () => {
    const tool = buildGetBriefTool(
      ctx,
      { matterEntityId: MATTER_ID },
      fakeDeps({
        getMatterBrief: async () => ({
          brief: {
            briefEntityId: 'b1',
            briefType: 'matter',
            markdown: 'Old status.',
            sections: [],
            generatedAt: '2026-06-01T00:00:00.000Z',
            modelIdentity: 'claude-x',
            confidence: 0.8,
            sourceWatermark: '2026-06-01T00:00:00.000Z',
          },
          stale: true,
          watermark: '2026-07-10T00:00:00.000Z',
        }),
      }),
    )
    const ack = await tool.run({})
    expect(ack).toContain('OUT OF DATE')
    expect(ack).toContain('Old status.')
    expect(ack).toContain('Refresh')
  })

  it('contact scope: resolves the client parent and reads the CLIENT brief', async () => {
    let resolvedWith: string | null = null
    const tool = buildGetBriefTool(
      ctx,
      { contactEntityId: CONTACT_ID },
      fakeDeps({
        resolveClientForContact: async (_c, contactEntityId) => {
          resolvedWith = contactEntityId
          return CLIENT_ID
        },
        getClientBrief: async () => ({
          brief: {
            briefEntityId: 'cb1',
            briefType: 'client',
            markdown: 'Client relationship summary.',
            sections: [],
            generatedAt: '2026-07-05T00:00:00.000Z',
            modelIdentity: 'claude-x',
            confidence: 0.7,
            sourceWatermark: '2026-07-05T00:00:00.000Z',
            research: null,
          },
          stale: false,
          watermark: '2026-07-05T00:00:00.000Z',
        }),
      }),
    )
    const ack = await tool.run({})
    expect(resolvedWith).toBe(CONTACT_ID)
    expect(ack).toContain('Client relationship summary.')
  })

  it('contact scope: honestly reports no client account when the contact has no parent', async () => {
    const tool = buildGetBriefTool(ctx, { contactEntityId: CONTACT_ID }, fakeDeps())
    const ack = await tool.run({})
    expect(ack).toContain('no client account on file')
  })

  it('unscoped: reports no matter or client in scope rather than erroring', async () => {
    const tool = buildGetBriefTool(ctx, {}, fakeDeps())
    const ack = await tool.run({})
    expect(ack).toContain('No matter or client is in scope')
  })
})
