// CAPABILITY-UNIFY-1 — ACCEPTANCE #4 (PROD, tenant zero). Prove the PROD builder
// chat authors a valid invoke_capability{document_generation} stage — naming a firm
// template by EXACT entity id — within the 2-attempt budget, using only the real
// product surfaces (get_workflow_context / propose_workflow via
// buildAttorneyClientTools + chatWithAssistantDetailed). Authoring-only: nothing is
// saved to a live service; the receipt is the captured proposal + an independent
// validateProposedLifecycle re-check + failedWorkflowAttempts count.
//
// Mirrors workflow-authoring-1-sandbox-run.ts's turn driver, pointed at tenant zero.
//   node --import tsx --env-file=.env.local verticals/legal/demo/capunify-builder-acceptance.ts
import '@exsto/legal'
import {
  resolveAnthropicApiKey,
  buildAttorneyClientTools,
  buildClaudeSystem,
  buildSkillCatalogText,
  buildActiveSkillsText,
  loadForcedSkills,
  listSkillCatalog,
  listStandaloneTemplates,
  wizardForcedSkillSlugs,
  validateProposedLifecycle,
  type AssistantChatInput,
  type WorkflowProposal,
  type Lifecycle,
} from '@exsto/legal'
import { chatWithAssistantDetailed, type ChatMessage } from '../src/adapters/claude.js'
import type { ActionContext } from '@exsto/substrate'

const TENANT = '00000000-0000-0000-0000-000000000001'
const ADMIN = '00000000-0000-0000-0001-000000000004'
const ctx: ActionContext = { tenantId: TENANT, actorId: ADMIN }
const MODEL = 'claude-opus-4-8'

async function driveTurn(message: string): Promise<{
  reply: string
  workflowProposals: WorkflowProposal[]
  failedWorkflowAttempts: string[]
}> {
  const input: AssistantChatInput = { message, modelId: `anthropic:${MODEL}` }
  const catalog = await listSkillCatalog(ctx)
  const forced = await loadForcedSkills(ctx, wizardForcedSkillSlugs(message, undefined, undefined))
  const system = buildClaudeSystem(
    'general',
    null,
    null,
    buildSkillCatalogText(catalog),
    buildActiveSkillsText(forced),
  )
  const workflowProposals: WorkflowProposal[] = []
  const failedWorkflowAttempts: string[] = []
  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    { role: 'user', content: message },
  ]
  const result = await chatWithAssistantDetailed(ctx.tenantId, messages, {
    model: MODEL,
    clientTools: buildAttorneyClientTools(ctx, input, {
      catalog,
      producedDocuments: [],
      workflowProposals,
      failedWorkflowAttempts,
      serviceProposals: [],
      questionnaireProposals: [],
      templateProposals: [],
      costProposals: [],
      enableProposals: [],
      buildQuestions: [],
      kindProposals: [],
    }),
  })
  return { reply: result.reply, workflowProposals, failedWorkflowAttempts }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const { apiKey } = await resolveAnthropicApiKey(TENANT)
  process.env.ANTHROPIC_API_KEY = apiKey

  const will = (await listStandaloneTemplates(ctx)).find(
    (t) => t.name === 'NC Last Will and Testament',
  )
  if (!will) throw new Error('will template not in firm library')

  const { reply, workflowProposals, failedWorkflowAttempts } = await driveTurn(
    'Design (do not save yet) the workflow for a new service: simple will drafting v2. ' +
      'Steps: the client completes intake and uploads any supporting documents; then the ' +
      'system drafts the will from our firm\'s "NC Last Will and Testament" template in the ' +
      'document library as an AI draft; then I review and send it; then the matter completes. ' +
      'Propose the workflow graph now via propose_workflow.',
  )

  const p = workflowProposals[0]
  const stage = p?.graph?.find(
    (s: Lifecycle[number]) =>
      s.action?.kind === 'invoke_capability' &&
      (s.action.config as { capability_slug?: string } | undefined)?.capability_slug ===
        'document_generation',
  )
  const cfg = (
    stage?.action?.config as
      | { capability_config?: { template_entity_id?: string; generation_mode?: string } }
      | undefined
  )?.capability_config

  // Independent re-validation of the captured graph (same validator propose_workflow ran).
  let revalidation: string[] = ['(no proposal captured)']
  if (p?.graph) revalidation = await validateProposedLifecycle(ctx, p.graph as Lifecycle)

  console.log(
    JSON.stringify(
      {
        proposalsCaptured: workflowProposals.length,
        failedWorkflowAttempts: failedWorkflowAttempts.length,
        withinTwoAttemptBudget: failedWorkflowAttempts.length <= 1 && workflowProposals.length >= 1,
        docGenStageKey: stage?.key ?? null,
        templateEntityId: cfg?.template_entity_id ?? null,
        templateIdIsExactWillId: cfg?.template_entity_id === will.templateEntityId,
        generationMode: cfg?.generation_mode ?? null,
        revalidationErrors: revalidation,
        graph: p?.graph ?? null,
        replyHead: reply.slice(0, 300),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
