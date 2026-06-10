import { registerTool, type Tool } from '@exsto/mcp-tools'
import { submitQuestionnaire, type SubmitQuestionnaireInput } from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

const tool: Tool<SubmitQuestionnaireInput, ActionResult> = {
  name: 'legal.questionnaire.submit',
  description: 'Record a completed intake questionnaire for a matter.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => submitQuestionnaire(ctx, input),
}

registerTool(tool)
