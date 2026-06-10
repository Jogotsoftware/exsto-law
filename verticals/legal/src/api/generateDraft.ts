import { randomUUID } from 'node:crypto'
import {
  submitAction,
  withActionContext,
  type ActionContext,
  type ActionResult,
} from '@exsto/substrate'
import { callClaudeDrafter } from '../adapters/claude.js'
import {
  loadDraftingPrompt,
  loadEngagementLetterTemplate,
  loadOperatingAgreementTemplate,
} from '../templates/loader.js'
import { getMatter } from '../queries/matters.js'

const SAGE_AGENT_ACTOR_ID = '00000000-0000-0000-0000-000000000003'

export interface GenerateDraftInput {
  matterEntityId: string
  documentKind: 'operating_agreement' | 'engagement_letter'
}

export async function generateDraft(
  ctx: ActionContext,
  input: GenerateDraftInput,
): Promise<ActionResult> {
  const matter = await getMatter(ctx, input.matterEntityId)
  if (!matter) {
    throw new Error(`Matter not found: ${input.matterEntityId}`)
  }
  if (!matter.questionnaireResponses) {
    throw new Error(
      `Matter ${input.matterEntityId} has no questionnaire response yet; cannot generate a draft.`,
    )
  }
  if (!matter.transcriptText) {
    throw new Error(
      `Matter ${input.matterEntityId} has no transcript yet; simulate or record the consultation call first.`,
    )
  }

  const template =
    input.documentKind === 'engagement_letter'
      ? loadEngagementLetterTemplate()
      : loadOperatingAgreementTemplate()
  const prompt = assembleDraftingPrompt({
    template,
    questionnaireResponses: matter.questionnaireResponses,
    transcriptText: matter.transcriptText,
    documentKind: input.documentKind,
  })

  const result = await callClaudeDrafter({ prompt })

  const reasoningTraceId = await persistReasoningTrace(ctx, {
    prompt,
    evidence: result.reasoningTrace.evidence,
    alternatives: result.reasoningTrace.alternatives_considered,
    conclusion: result.reasoningTrace.conclusion,
    confidence: result.reasoningTrace.confidence,
    modelIdentity: result.modelIdentity,
    fullTrace: result.reasoningTrace,
  })

  return submitAction(ctx, {
    actionKindName: 'legal.draft.generate',
    intentKind: 'enforcement',
    reasoningTraceId,
    payload: {
      matter_entity_id: input.matterEntityId,
      document_kind: input.documentKind,
      document_markdown: result.documentMarkdown,
      model_identity: result.modelIdentity,
      reasoning_trace_id: reasoningTraceId,
      jurisdiction: 'NC',
    },
  })
}

interface AssembleArgs {
  template: string
  questionnaireResponses: Record<string, unknown>
  transcriptText: string
  documentKind: 'operating_agreement' | 'engagement_letter'
}

function assembleDraftingPrompt(args: AssembleArgs): string {
  const basePrompt = loadDraftingPrompt()
  return basePrompt
    .replace(
      '{{questionnaire_responses_json}}',
      JSON.stringify(args.questionnaireResponses, null, 2),
    )
    .replace('{{transcript_text}}', args.transcriptText)
    .replace('{{operating_agreement_template}}', args.template)
    .replace(
      /operating agreement/gi,
      args.documentKind === 'engagement_letter' ? 'engagement letter' : 'operating agreement',
    )
}

interface PersistTraceArgs {
  prompt: string
  evidence: unknown[]
  alternatives: unknown[]
  conclusion: string
  confidence: number
  modelIdentity: string
  fullTrace: unknown
}

async function persistReasoningTrace(ctx: ActionContext, args: PersistTraceArgs): Promise<string> {
  const id = randomUUID()
  await withActionContext(ctx, async (client) => {
    await client.query(
      `INSERT INTO reasoning_trace (
         id, tenant_id, agent_actor_id, prompt, evidence, alternatives,
         conclusion, confidence, model_identity, trace
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10::jsonb)`,
      [
        id,
        ctx.tenantId,
        SAGE_AGENT_ACTOR_ID,
        args.prompt,
        JSON.stringify(args.evidence),
        JSON.stringify(args.alternatives),
        args.conclusion,
        clampConfidence(args.confidence),
        args.modelIdentity,
        JSON.stringify(args.fullTrace),
      ],
    )
  })
  return id
}

function clampConfidence(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return 0.5
  return Math.min(1, Math.max(0, n))
}
