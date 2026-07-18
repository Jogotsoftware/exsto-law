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
  type AssistantChatInput,
  type EmailComposeCapture,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

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
  it('registers compose_email + prepare_envelope on a matter-scoped turn', () => {
    const names = toolNames({
      message: 'email the client',
      modelId: 'a',
      matterEntityId: MATTER_ID,
    })
    expect(names).toContain('compose_email')
    expect(names).toContain('prepare_envelope')
  })

  it('registers compose_email but NOT prepare_envelope on a contact-scoped turn', () => {
    const names = toolNames({
      message: 'email the client',
      modelId: 'a',
      contactEntityId: CONTACT_ID,
    })
    expect(names).toContain('compose_email')
    // Envelopes resolve against a matter's documents; a contact scope has none.
    expect(names).not.toContain('prepare_envelope')
  })

  it('registers NEITHER on a global (unscoped) turn', () => {
    const names = toolNames({ message: 'email the client', modelId: 'a' })
    expect(names).not.toContain('compose_email')
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
  it('teaches composing + signature on a matter scope', () => {
    const system = buildClaudeSystem('matter', MATTER_ID, null)
    expect(system).toContain('COMPOSING CLIENT EMAILS')
    expect(system).toContain('SENDING FOR SIGNATURE')
    // The honesty rule rides the block: the composer is the review.
    expect(system).toContain("NEVER say the email 'will go to the review queue'")
  })

  it('teaches composing but not signature on a contact scope', () => {
    const system = buildClaudeSystem('contact', CONTACT_ID, null)
    expect(system).toContain('COMPOSING CLIENT EMAILS')
    expect(system).not.toContain('SENDING FOR SIGNATURE')
  })

  it('teaches neither on a global scope (dormancy)', () => {
    const system = buildClaudeSystem('global', null, null)
    expect(system).not.toContain('COMPOSING CLIENT EMAILS')
    expect(system).not.toContain('SENDING FOR SIGNATURE')
    expect(system).not.toContain('compose_email')
    expect(system).not.toContain('prepare_envelope')
  })
})
