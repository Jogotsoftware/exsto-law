import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  assistantChat,
  submitAssistantFeedback,
  listAssistantThread,
  listAssistantThreads,
  listAssistantModels,
  listAssistantFeedback,
  getAiUsageSummary,
  saveAssistantReplyToMatter,
  type AssistantChatInput,
  type AssistantChatReply,
  type SubmitFeedbackInput,
  type AssistantThreadEntry,
  type AssistantThreadSummary,
  type AssistantModel,
  type AssistantFeedbackEntry,
  type AiUsageSummary,
  type SaveAssistantReplyInput,
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
      attachments: {
        type: 'array',
        description:
          'Documents the attorney attached to this message (Claude only): each { name, text }. Appended to the prompt as extra context; never sent to an external research model. Bounded server-side.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            text: { type: 'string' },
          },
          required: ['name', 'text'],
          additionalProperties: false,
        },
      },
      intent: {
        type: 'string',
        enum: ['feedback', 'question'],
        description: 'Optional hint: a "Leave feedback" entry point forces feedback.',
      },
      category: {
        type: 'string',
        enum: ['ui', 'ai', 'workflow', 'feature', 'other'],
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
  name: 'legal.assistant.threads',
  description:
    "The attorney's prior assistant conversations grouped by scope (one per matter/client, plus the global app-help thread), most-recent first — each with a label, a snippet of the latest question, and a turn count. Powers the history picker; excludes beta-feedback turns.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ threads: await listAssistantThreads(ctx) }),
} satisfies Tool<Record<string, never>, { threads: AssistantThreadSummary[] }>)

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
        enum: ['ui', 'ai', 'workflow', 'feature', 'other'],
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
    'All beta feedback (newest first) with its category (ui/ai/workflow/feature/other) and page context — the triage surface.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ feedback: await listAssistantFeedback(ctx) }),
} satisfies Tool<Record<string, never>, { feedback: AssistantFeedbackEntry[] }>)

registerTool({
  name: 'legal.assistant.usage',
  description:
    "Firm-wide AI token usage and ESTIMATED cost over the trailing window (sinceDays, default 30), broken down by model and by day. Reads the token usage recorded on each Claude assistant.turn event; Perplexity turns don't report tokens. Cost is an estimate from list prices. Powers the Settings → AI usage tab.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      sinceDays: {
        type: 'number',
        description: 'Trailing window in days (1–365). Default 30.',
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) =>
    getAiUsageSummary(ctx, { sinceDays: input?.sinceDays }),
} satisfies Tool<{ sinceDays?: number }, AiUsageSummary>)

registerTool({
  name: 'legal.assistant.save_reply',
  description:
    "Save an assistant reply as a document draft on a matter (pending review), so a useful answer/letter/memo is kept on the matter instead of copy-pasted out. Lands in the matter's drafts/review like any AI draft.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string', description: 'The matter to attach the draft to.' },
      markdown: { type: 'string', description: 'The reply markdown to save.' },
      documentKind: {
        type: 'string',
        description: 'Optional kind tag (e.g. memo, letter); defaults to assistant_draft.',
      },
      modelIdentity: { type: 'string', description: 'Optional model that produced the reply.' },
    },
    required: ['matterEntityId', 'markdown'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => saveAssistantReplyToMatter(ctx, input),
} satisfies Tool<SaveAssistantReplyInput, { draftVersionId: string | null }>)
