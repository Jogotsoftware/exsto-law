import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  assistantChat,
  submitAssistantFeedback,
  listAssistantThread,
  listAssistantModels,
  listAssistantFeedback,
  type AssistantChatInput,
  type AssistantChatReply,
  type SubmitFeedbackInput,
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
      workRate: {
        type: 'string',
        enum: ['quick', 'balanced', 'thorough'],
        description:
          "Effort knob (effort + adaptive thinking). Honoured on Opus 4.8 / Sonnet 4.6; ignored on Haiku/Perplexity. Default 'balanced'.",
      },
      webSearch: {
        type: 'boolean',
        description:
          'Turn on live web search for Claude (adds citations). Perplexity always searches regardless.',
      },
      useContext: {
        type: 'boolean',
        description:
          'When false, treat the message as GENERAL — not grounded in or threaded on the current matter/client. Default true.',
      },
      contextDepth: {
        type: 'string',
        enum: ['lean', 'balanced', 'generous'],
        description:
          'How much matter/client history to feed the model (emails, transcript, intake, draft). More = richer grounding but a larger, slower, pricier prompt. Default balanced.',
      },
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
  name: 'legal.assistant.feedback_submit',
  description:
    'Submit beta feedback directly to the team (the Beta button). Records the message with its category and the exact page/section the attorney was on, as a feedback event on the substrate. Makes NO model call and returns no reply — pure capture.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: "The attorney's feedback." },
      category: {
        type: 'string',
        enum: ['ui', 'ai', 'workflow', 'other'],
        description: 'Which area the feedback is about.',
      },
      pageContext: {
        type: 'object',
        description: 'Where they were, e.g. { path, section }.',
        additionalProperties: true,
      },
      matterEntityId: { type: 'string', description: 'Thread the feedback on this matter too.' },
      contactEntityId: { type: 'string', description: 'Thread the feedback on this client too.' },
    },
    required: ['message'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await submitAssistantFeedback(ctx, input),
} satisfies Tool<SubmitFeedbackInput, { eventId: string }>)

registerTool({
  name: 'legal.assistant.feedback_list',
  description:
    'All beta feedback (newest first) with its category (ui/ai/workflow/other) and page context — the triage surface.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ feedback: await listAssistantFeedback(ctx) }),
} satisfies Tool<Record<string, never>, { feedback: AssistantFeedbackEntry[] }>)
