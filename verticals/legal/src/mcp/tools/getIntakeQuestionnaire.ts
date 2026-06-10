import { registerTool, type Tool } from '@exsto/mcp-tools'
import { loadIntakeQuestionnaire, type IntakeQuestionnaire } from '../../index.js'

const tool: Tool<Record<string, never>, { questionnaire: IntakeQuestionnaire }> = {
  name: 'legal.questionnaire.get_template',
  description: 'Return the intake questionnaire schema for the operating agreement workflow.',
  mode: 'read',
  handler: async () => {
    return { questionnaire: loadIntakeQuestionnaire() }
  },
}

registerTool(tool)
