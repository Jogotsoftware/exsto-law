import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  assistantChat,
  listAssistantThread,
  listAssistantModels,
  listAssistantFeedback,
  type AssistantChatInput,
  type AssistantChatReply,
  type AssistantThreadEntry,
  type AssistantModel,
  type AssistantFeedbackEntry,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Unified assistant chat for the attorney workspace. Switch between any
// connected AI model (Claude / Perplexity), with the current matter or client
// context injected automatically, and beta feedback captured inline. Every
// exchange is appended to the substrate as an assistant.turn event (matter- or
// contact-scoped, or global for the feedback FAB).

registerTool({
  name: 'legal.assistant.models',
  description:
    'List the AI models the attorney can chat with, each flagged with whether its provider integration is connected and whether the app has an adapter for it. Powers the model switcher.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ models: await listAssistantModels(ctx) }),
} satisfies Tool<Record<string, never>, { models: AssistantModel[] }>)

registerTool({
  name: 'legal.assistant.chat',
  description:
    "Send a message to the chosen AI model. Pass matterEntityId or contactEntityId to ground the answer in that matter/client (Claude gets full context; Perplexity gets only a non-confidential framing). Omit both for a global app-help/feedback chat. Returns the reply (with citations for research models) and records the exchange. Uses the firm's Settings-managed API keys.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: "The attorney's message." },
      modelId: {
        type: 'string',
        description: "Model id from legal.assistant.models, e.g. 'anthropic:claude-sonnet-4-6'.",
      },
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
      matterEntityId: { type: 'string', description: 'Scope the chat to this matter.' },
      contactEntityId: { type: 'string', description: 'Scope the chat to this client contact.' },
      intent: {
        type: 'string',
        enum: ['feedback', 'question'],
        description: 'Optional hint: a "Leave feedback" entry point forces feedback.',
      },
      category: {
        type: 'string',
        enum: ['ui', 'ai', 'workflow', 'other'],
        description: 'Beta-feedback category (feedback turns only).',
      },
      pageContext: {
        type: 'object',
        description: 'Where the attorney was (e.g. { path }) when leaving feedback.',
        additionalProperties: true,
      },
    },
    required: ['message', 'modelId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await assistantChat(ctx, input),
} satisfies Tool<AssistantChatInput, AssistantChatReply>)

registerTool({
  name: 'legal.assistant.thread',
  description:
    'Prior assistant-chat turns for a matter or client (oldest-first), so reopening the chat shows its history. Omit both ids for the global thread.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      contactEntityId: { type: 'string' },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    turns: await listAssistantThread(ctx, input ?? {}),
  }),
} satisfies Tool<
  { matterEntityId?: string; contactEntityId?: string },
  { turns: AssistantThreadEntry[] }
>)

registerTool({
  name: 'legal.assistant.feedback_list',
  description:
    'All beta feedback (newest first) with its category (ui/ai/workflow/other) and page context — the triage surface.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ feedback: await listAssistantFeedback(ctx) }),
} satisfies Tool<Record<string, never>, { feedback: AssistantFeedbackEntry[] }>)
