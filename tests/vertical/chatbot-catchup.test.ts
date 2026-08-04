// CHATBOT-CATCHUP-1 — the chat wires this wave added, pinned with plain fakes
// (no DB, no model): the read-only get_task_queue read-back, the
// engagement-letter pair's name resolution + honest empty/ambiguity paths, the
// matter-party pair's hint matching + dedupe, prepare_envelope's new
// upload/blank mode + no-matter redirect, and the two builder schema
// extensions (offer_spanish on propose_service; fields/presigned/
// allowAddNextSigner on propose_template's e-sign roles) — the
// additionalProperties:false lesson means an unlisted field is UNREACHABLE
// from chat, so these assertions are what keep the schemas honest.
import { describe, it, expect } from 'vitest'
import {
  renderTaskQueueForModel,
  buildTaskQueueTool,
  buildListEngagementLettersTool,
  buildSetDefaultEngagementLetterTool,
  renderEngagementLettersForModel,
  contactMatchesHint,
  buildMatterPartiesTool,
  buildLinkMatterContactTool,
  buildPrepareEnvelopeTool,
  buildProposeServiceTool,
  buildProposeTemplateTool,
  type AttorneyTask,
  type EnvelopePrepareLaunch,
  type MatterPartyToolDeps,
  type EngagementLetterToolDeps,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

function task(overrides: Partial<AttorneyTask> = {}): AttorneyTask {
  return {
    id: 't1',
    type: 'document_review',
    typeLabel: 'Document Review',
    title: 'operating agreement',
    clientName: 'Maria Gomez',
    matterNumber: 'PL-2026-0007',
    matterEntityId: 'm1',
    contactEntityId: null,
    date: '2026-08-01T00:00:00Z',
    dateLabel: 'Generated',
    status: 'pending_review',
    workHref: '/attorney/review/v1',
    ...overrides,
  }
}

describe('get_task_queue', () => {
  it('renders an honest empty-queue read-back', () => {
    expect(renderTaskQueueForModel([])).toContain('empty')
  })

  it('renders one line per task with type, client and the workHref to act', () => {
    const out = renderTaskQueueForModel([task()])
    expect(out).toContain('[Document Review]')
    expect(out).toContain('Maria Gomez')
    expect(out).toContain('/attorney/review/v1')
  })

  it('run() reads through the injected dep', async () => {
    const tool = buildTaskQueueTool(ctx, { listAttorneyTasks: async () => [task()] })
    expect(tool.name).toBe('get_task_queue')
    await expect(tool.run({})).resolves.toContain('Maria Gomez')
  })
})

describe('engagement-letter tools', () => {
  const letters = [
    { templateId: 'a', name: 'Flat-Fee LLC Letter', isDefault: true, updatedAt: '2026-08-01' },
    { templateId: 'b', name: 'Litigation Letter', isDefault: false, updatedAt: '2026-08-01' },
  ]
  const deps = (calls: string[]): EngagementLetterToolDeps => ({
    listEngagementLetters: async () => letters,
    setDefaultEngagementLetter: async (_c, templateId) => {
      calls.push(templateId)
      return { templateId }
    },
  })

  it('list renders the library with the default marked', () => {
    const out = renderEngagementLettersForModel(letters)
    expect(out).toContain('Flat-Fee LLC Letter — DEFAULT')
    expect(out).toContain('Litigation Letter')
    expect(renderEngagementLettersForModel([])).toContain('no engagement letters')
  })

  it('set_default resolves by name words and writes through the dep', async () => {
    const calls: string[] = []
    const tool = buildSetDefaultEngagementLetterTool(ctx, deps(calls))
    const out = await tool.run({ letter_hint: 'litigation' })
    expect(calls).toEqual(['b'])
    expect(out).toContain('now the firm')
  })

  it('set_default is a no-op with an honest reply when already default', async () => {
    const calls: string[] = []
    const tool = buildSetDefaultEngagementLetterTool(ctx, deps(calls))
    const out = await tool.run({ letter_hint: 'flat fee llc' })
    expect(calls).toEqual([])
    expect(out).toContain('already')
  })

  it('set_default surfaces ambiguity instead of guessing', async () => {
    const calls: string[] = []
    const tool = buildSetDefaultEngagementLetterTool(ctx, deps(calls))
    const out = await tool.run({ letter_hint: 'letter' })
    expect(calls).toEqual([])
    expect(out).toContain('More than one')
  })

  it('list tool run() renders through the dep', async () => {
    const tool = buildListEngagementLettersTool(ctx, deps([]))
    await expect(tool.run({})).resolves.toContain('Flat-Fee LLC Letter')
  })
})

describe('matter-party tools', () => {
  it('contactMatchesHint requires every hint word, in name or email', () => {
    const c = { fullName: 'Maria Alvarez-Reyes', email: 'maria@acme.com' }
    expect(contactMatchesHint(c, 'maria alvarez')).toBe(true)
    expect(contactMatchesHint(c, 'maria@acme.com')).toBe(true)
    expect(contactMatchesHint(c, 'jose alvarez')).toBe(false)
    expect(contactMatchesHint(c, '')).toBe(false)
  })

  const contacts = [
    { contactEntityId: 'c1', fullName: 'Maria Alvarez', email: 'maria@acme.com' },
    { contactEntityId: 'c2', fullName: 'Maria Lopez', email: 'mlopez@x.com' },
    { contactEntityId: 'c3', fullName: 'Sam Roe', email: 'sam@x.com' },
  ]
  const deps = (linked: string[], parties: { id: string }[] = []): MatterPartyToolDeps => ({
    // Only the fields the tool reads are populated; the rest of ContactSummary
    // is irrelevant to resolution.
    listContacts: async () => contacts as never,
    listMatterPartyContacts: async () =>
      parties.map((p) => ({ id: p.id, fullName: 'Maria Alvarez', email: 'maria@acme.com' })),
    linkContact: async (_c, _m, contactEntityId) => {
      linked.push(contactEntityId)
    },
  })

  it('links a uniquely-matched contact through the action-layer dep', async () => {
    const linked: string[] = []
    const tool = buildLinkMatterContactTool(ctx, 'm1', deps(linked))
    const out = await tool.run({ contact_hint: 'alvarez' })
    expect(linked).toEqual(['c1'])
    expect(out).toContain('linked')
  })

  it('surfaces ambiguity and never links', async () => {
    const linked: string[] = []
    const tool = buildLinkMatterContactTool(ctx, 'm1', deps(linked))
    const out = await tool.run({ contact_hint: 'maria' })
    expect(linked).toEqual([])
    expect(out).toContain('More than one')
  })

  it('refuses to invent a contact on no match', async () => {
    const linked: string[] = []
    const tool = buildLinkMatterContactTool(ctx, 'm1', deps(linked))
    const out = await tool.run({ contact_hint: 'nobody here' })
    expect(linked).toEqual([])
    expect(out).toContain('never creates a new contact')
  })

  it('dedupes an already-linked party with an honest no-op', async () => {
    const linked: string[] = []
    const tool = buildLinkMatterContactTool(ctx, 'm1', deps(linked, [{ id: 'c1' }]))
    const out = await tool.run({ contact_hint: 'alvarez' })
    expect(linked).toEqual([])
    expect(out).toContain('already linked')
  })

  it('get_matter_parties reads honestly when empty', async () => {
    const tool = buildMatterPartiesTool(ctx, 'm1', deps([]))
    await expect(tool.run({})).resolves.toContain('only the primary client')
  })
})

describe('prepare_envelope modes', () => {
  it("mode 'upload' captures a blank launch with no matter needed", async () => {
    const captured: EnvelopePrepareLaunch[] = []
    const tool = buildPrepareEnvelopeTool(ctx, null, captured)
    const out = await tool.run({ mode: 'upload' })
    expect(captured).toEqual([{ mode: 'blank' }])
    expect(out).toContain('attach their PDF')
  })

  it("mode 'matter_document' with no matter redirects honestly instead of dead-ending", async () => {
    const captured: EnvelopePrepareLaunch[] = []
    const tool = buildPrepareEnvelopeTool(ctx, null, captured)
    const out = await tool.run({ mode: 'matter_document', document_hint: 'engagement letter' })
    expect(captured).toEqual([])
    expect(out).toContain('no matter in scope')
  })

  it('rejects an unknown mode', async () => {
    const captured: EnvelopePrepareLaunch[] = []
    const tool = buildPrepareEnvelopeTool(ctx, null, captured)
    await expect(tool.run({})).resolves.toContain('mode must be')
  })
})

describe('builder schema reach (additionalProperties: false)', () => {
  it('propose_service exposes offer_spanish', () => {
    const def = buildProposeServiceTool(ctx, []).definition as {
      input_schema: { properties: Record<string, unknown> }
    }
    expect(def.input_schema.properties).toHaveProperty('offer_spanish')
  })

  it('propose_template e-sign roles expose fields, presigned and allowAddNextSigner', () => {
    const def = buildProposeTemplateTool(ctx, []).definition as {
      input_schema: {
        properties: {
          esign_config: {
            properties: { roles: { items: { properties: Record<string, unknown> } } }
          }
        }
      }
    }
    const roleProps = def.input_schema.properties.esign_config.properties.roles.items.properties
    expect(roleProps).toHaveProperty('fields')
    expect(roleProps).toHaveProperty('presigned')
    expect(roleProps).toHaveProperty('allowAddNextSigner')
    expect(roleProps).toHaveProperty('repeatPerParty')
  })
})
