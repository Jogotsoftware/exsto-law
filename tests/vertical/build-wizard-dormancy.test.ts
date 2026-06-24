// Build-Wizard Phase 4 (the orchestrator) — DORMANCY is the critical property:
// with LEGAL_BUILD_WIZARD off the chatbot is byte-for-byte unchanged (no wizard
// tools, no orchestrator system-prompt block); with it on, the WHOLE guided build
// is available (every propose_* tool + the completeness check + the orchestrator
// block). These are PURE: buildAttorneyClientTools constructs tools lazily (each
// run() is deferred) and buildClaudeSystem is pure string building, so no live DB
// or model is touched — the test can pass a minimal ctx.
import { describe, it, expect, afterEach } from 'vitest'
import { buildAttorneyClientTools, buildClaudeSystem, type AssistantChatInput } from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

const input: AssistantChatInput = { message: 'build me an NC LLC formation service', modelId: 'a' }

// The empty capture buckets buildAttorneyClientTools needs — none are written by
// mere construction (the tools only push on run()), so they stay empty here.
function emptyCapture() {
  return {
    catalog: [{ slug: 's', name: 'Skill' }],
    producedDocuments: [],
    workflowProposals: [],
    serviceProposals: [],
    questionnaireProposals: [],
    templateProposals: [],
  }
}

function toolNames(): string[] {
  return buildAttorneyClientTools(ctx, input, emptyCapture()).map((t) => t.name)
}

// The full set of build-wizard tools (Phases 1–4) that must appear ONLY behind the
// flag. The workflow pair is intentionally NOT here — it's always-on (PR5) and the
// wizard composes it; we assert that separately.
const WIZARD_ONLY_TOOLS = [
  'get_service_context',
  'propose_service',
  'get_questionnaire_context',
  'propose_questionnaire',
  'get_template_context',
  'propose_template',
  'get_service_completeness',
]

// The orchestrator block's load-bearing heading — present only when the wizard is on.
const ORCHESTRATOR_MARKER = 'BUILDING A SERVICE (the guided wizard)'

describe('build wizard dormancy (LEGAL_BUILD_WIZARD off)', () => {
  afterEach(() => {
    delete process.env.LEGAL_BUILD_WIZARD
  })

  it('registers NONE of the wizard tools when the flag is off', () => {
    delete process.env.LEGAL_BUILD_WIZARD
    const names = toolNames()
    for (const t of WIZARD_ONLY_TOOLS) expect(names).not.toContain(t)
  })

  it('omits the orchestrator system-prompt block when the flag is off', () => {
    delete process.env.LEGAL_BUILD_WIZARD
    const system = buildClaudeSystem('global', null, null)
    expect(system).not.toContain(ORCHESTRATOR_MARKER)
    // And it teaches nothing about creating services at all (Phase 1 note absent too).
    expect(system).not.toContain('CREATING A NEW SERVICE')
  })

  it('keeps the always-on, non-wizard tools regardless of the flag (no regression)', () => {
    delete process.env.LEGAL_BUILD_WIZARD
    const names = toolNames()
    // log_feedback + produce_document + the always-on workflow pair + load_skill.
    expect(names).toContain('log_feedback')
    expect(names).toContain('produce_document')
    expect(names).toContain('get_workflow_context')
    expect(names).toContain('propose_workflow')
  })
})

describe('build wizard activation (LEGAL_BUILD_WIZARD on)', () => {
  afterEach(() => {
    delete process.env.LEGAL_BUILD_WIZARD
  })

  it('registers ALL wizard tools together when the flag is on', () => {
    process.env.LEGAL_BUILD_WIZARD = '1'
    const names = toolNames()
    for (const t of WIZARD_ONLY_TOOLS) expect(names).toContain(t)
    // The wizard COMPOSES the always-on workflow pair, so they must be present too.
    expect(names).toContain('get_workflow_context')
    expect(names).toContain('propose_workflow')
  })

  it('includes the orchestrator system-prompt block when the flag is on', () => {
    process.env.LEGAL_BUILD_WIZARD = 'true'
    const system = buildClaudeSystem('global', null, null)
    expect(system).toContain(ORCHESTRATOR_MARKER)
    // It points the model at the playbook skill and encodes the load-bearing order.
    expect(system).toContain('firm-admin.build-service')
    expect(system).toContain('DOCUMENTS → VARIABLES → QUESTIONNAIRE')
    expect(system).toContain('get_service_completeness')
  })
})
