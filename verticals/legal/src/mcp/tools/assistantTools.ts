import { registerTool, type Tool } from '@exsto/mcp-tools'
import { askAssistant, type AskAssistantInput, type AssistantReply } from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// In-app assistant for the attorney workspace. Answers app-usage questions AND
// collects product feedback. Write-mode: every exchange is appended to the
// substrate as a feedback.recorded event (provenance human:actorId) before the
// reply is returned, so feedback is auditable data, not a fire-and-forget form.
registerTool({
  name: 'legal.assistant.ask',
  description:
    'Ask the in-app assistant a question about using the app, or leave feedback. Returns a short reply and records the exchange (message + reply + page context) on the feedback timeline. Uses the firm’s Settings-managed Anthropic key.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'The attorney’s message or feedback.' },
      history: {
        type: 'array',
        description: 'Prior turns of this conversation, oldest-first.',
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ['user', 'assistant'] },
            content: { type: 'string' },
          },
          required: ['role', 'content'],
          additionalProperties: false,
        },
      },
      pageContext: {
        type: 'object',
        description:
          'Where the attorney was (e.g. { path, intent }) when they opened the assistant.',
        additionalProperties: true,
      },
    },
    required: ['message'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await askAssistant(ctx, input),
} satisfies Tool<AskAssistantInput, AssistantReply>)
