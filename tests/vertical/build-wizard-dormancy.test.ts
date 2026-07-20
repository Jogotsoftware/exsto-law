// Build-Wizard Phase 4 (the orchestrator) — DORMANCY is the critical property:
// with LEGAL_BUILD_WIZARD off the chatbot is byte-for-byte unchanged (no wizard
// tools, no orchestrator system-prompt block); with it on, the WHOLE guided build
// is available (every propose_* tool + the completeness check + the orchestrator
// block). These are PURE: buildAttorneyClientTools constructs tools lazily (each
// run() is deferred) and buildClaudeSystem is pure string building, so no live DB
// or model is touched — the test can pass a minimal ctx.
import { describe, it, expect, afterEach } from 'vitest'
import {
  buildAttorneyClientTools,
  buildClaudeSystem,
  type AssistantChatInput,
  type AssistantFirmFacts,
} from '@exsto/legal'
import type { ActionContext } from '@exsto/substrate'

const ctx: ActionContext = {
  tenantId: '00000000-0000-0000-0000-000000000001',
  actorId: '00000000-0000-0000-0001-000000000002',
}

// WP A2 — buildClaudeSystem now takes the firm's own facts (name/jurisdiction/
// practice areas) instead of hardcoding Pacheco Law/NC. This suite is about
// wizard-flag dormancy, not jurisdiction content, so a minimal stand-in firm.
const TEST_FIRM: AssistantFirmFacts = { firmName: 'Test Firm' }

const input: AssistantChatInput = { message: 'build me an NC LLC formation service', modelId: 'a' }

// The empty capture buckets buildAttorneyClientTools needs — none are written by
// mere construction (the tools only push on run()), so they stay empty here.
function emptyCapture() {
  return {
    catalog: [{ slug: 's', name: 'Skill' }],
    producedDocuments: [],
    workflowProposals: [],
    // WORKFLOW-AUTHORING-1 — empty bucket, like the rest.
    failedWorkflowAttempts: [],
    serviceProposals: [],
    questionnaireProposals: [],
    templateProposals: [],
    // Phase 6 (billing + the terminal Enable) — empty buckets, like the rest.
    costProposals: [],
    enableProposals: [],
    // Phase 7 (the structured interview) — empty bucket, like the rest.
    buildQuestions: [],
    kindProposals: [],
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
  // Phase 6 — billing + the terminal Enable. These complete the self-driving build:
  // propose_cost sets the fee model; propose_enable flips the service to active.
  'propose_cost',
  'propose_enable',
  // Phase 7 — the structured interview. ask_build_question turns each interview question
  // into a click-to-answer card (the headline "make it feel like a wizard" fix).
  'ask_build_question',
]

// The orchestrator block's load-bearing heading — present only when the wizard is
// on. WORKFLOW-AUTHORING-1 consolidated the inline flow text into the
// firm-admin.build-service skill (single source of truth), so the prompt now
// carries a short POINTER plus the non-negotiable behaviors — the old inline
// markers (continuous-flow, propose_enable, ask-don't-assume prose) moved to the
// skill and are asserted there, not here.
const ORCHESTRATOR_MARKER = 'BUILDING A WHOLE SERVICE (the guided wizard)'
const ASK_TOOL_MARKER = 'ask_build_question'

describe('build wizard dormancy (LEGAL_BUILD_WIZARD off)', () => {
  afterEach(() => {
    delete process.env.LEGAL_BUILD_WIZARD
  })

  // D8 (#369) flipped the default ON — "off" now means explicitly LEGAL_BUILD_WIZARD=0,
  // so these tests set it rather than delete it (deleting tests the ON default).
  it('registers NONE of the wizard tools when the flag is off', () => {
    process.env.LEGAL_BUILD_WIZARD = '0'
    const names = toolNames()
    for (const t of WIZARD_ONLY_TOOLS) expect(names).not.toContain(t)
  })

  it('omits the orchestrator system-prompt block when the flag is off', () => {
    process.env.LEGAL_BUILD_WIZARD = '0'
    const system = buildClaudeSystem('global', null, null, TEST_FIRM)
    expect(system).not.toContain(ORCHESTRATOR_MARKER)
    // And it teaches nothing about creating services at all (Phase 1 note absent too).
    expect(system).not.toContain('CREATING A NEW SERVICE')
    // The ask_build_question tool is never even named with the flag off.
    expect(system).not.toContain(ASK_TOOL_MARKER)
  })

  it('keeps the always-on, non-wizard tools regardless of the flag (no regression)', () => {
    process.env.LEGAL_BUILD_WIZARD = '0'
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
    const system = buildClaudeSystem('global', null, null, TEST_FIRM)
    expect(system).toContain(ORCHESTRATOR_MARKER)
    // It points the model at the AUTHORITATIVE playbook skill (the flow itself
    // lives there — single source of truth) and keeps the two non-negotiables
    // inline: interview via ask_build_question cards, no platform vocabulary.
    expect(system).toContain('firm-admin.build-service')
    expect(system).toContain(ASK_TOOL_MARKER)
    expect(system).toContain('NEVER use platform vocabulary')
  })

  it('frames the documents→questionnaire flow as forward-looking + reuse-aware (Phase 7)', () => {
    process.env.LEGAL_BUILD_WIZARD = '1'
    const system = buildClaudeSystem('global', null, null, TEST_FIRM)
    // Flow-aware: tokens before a questionnaire exists are NOT "missing/broken".
    expect(system).toContain('DOCUMENTS COME BEFORE THE QUESTIONNAIRE')
    // Reuse-aware: existing firm questions are reused, not re-invented.
    expect(system).toContain('REUSE EXISTING FIRM QUESTIONS')
    expect(system).toContain('firmFieldLibrary')
  })
})
