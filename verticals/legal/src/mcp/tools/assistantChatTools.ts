import { registerTool, type Tool } from '@exsto/mcp-tools'
import { buildWizardEnabled } from '../../lifecycle/flags.js'
import {
  assistantChat,
  submitAssistantFeedback,
  listAssistantThread,
  listAssistantThreads,
  listAssistantModels,
  listAssistantFeedback,
  getAiUsageSummary,
  saveAssistantReplyToMatter,
  listChatSessions,
  closeChatSession,
  getAssistantSettings,
  setAssistantSettings,
  recordBuildArtifactEdited,
  type AssistantChatInput,
  type AssistantChatReply,
  type SubmitFeedbackInput,
  type AssistantThreadEntry,
  type AssistantThreadSummary,
  type AssistantModel,
  type AssistantFeedbackEntry,
  type AiUsageSummary,
  type SaveAssistantReplyInput,
  type ChatSessionSummary,
  type AssistantSettings,
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
    'List the AI models the attorney can chat with, each flagged with whether its provider integration is connected and whether the app has an adapter for it. Powers the model switcher. Also returns `buildWizard`: whether the guided service-build wizard is enabled for this deployment (LEGAL_BUILD_WIZARD), so the chat can show the "Build a service" control only when it is on.',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  // buildWizard rides on the models response (already fetched on mount) so the client
  // learns the server-side flag without a second round-trip — and the control stays
  // dormant (and byte-for-byte unchanged) whenever the flag is off.
  handler: async (ctx: ActionContext) => ({
    models: await listAssistantModels(ctx),
    buildWizard: buildWizardEnabled(),
  }),
} satisfies Tool<Record<string, never>, { models: AssistantModel[]; buildWizard: boolean }>)

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
      chatSessionId: {
        type: 'string',
        description:
          'The saved conversation this turn continues (from a prior reply). Omit to start a new conversation; the reply returns the session id to resend.',
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
    'Prior assistant-chat turns (oldest-first), so reopening the chat shows its history. Pass chatSessionId to read ONE saved conversation; else pass matterEntityId/contactEntityId for that legacy scope thread, or omit all for the global thread.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      contactEntityId: { type: 'string' },
      chatSessionId: {
        type: 'string',
        description:
          'Read the turns of this saved conversation (from legal.assistant.chat_sessions).',
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    turns: await listAssistantThread(ctx, input ?? {}),
  }),
} satisfies Tool<
  { matterEntityId?: string; contactEntityId?: string; chatSessionId?: string },
  { turns: AssistantThreadEntry[] }
>)

registerTool({
  name: 'legal.assistant.chat_sessions',
  description:
    "The attorney's saved assistant conversations (assistant_chat_session), most-recent-activity first — title, scope, status, turn count. Powers the conversation switcher; a conversation's turns come from legal.assistant.thread with chatSessionId.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ sessions: await listChatSessions(ctx) }),
} satisfies Tool<Record<string, never>, { sessions: ChatSessionSummary[] }>)

registerTool({
  name: 'legal.assistant.chat_session_close',
  description:
    'Close a saved assistant conversation (it stays readable in history; new messages start a fresh conversation).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { chatSessionId: { type: 'string' } },
    required: ['chatSessionId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    await closeChatSession(ctx, input.chatSessionId)
    return { closed: true }
  },
} satisfies Tool<{ chatSessionId: string }, { closed: boolean }>)

registerTool({
  name: 'legal.assistant.build_artifact_edited',
  description:
    'Record that the attorney hand-edited a proposed artifact in the wizard pop-up editor before approving it (an observation event threaded on the build session), so the build trail reads proposal → human edit → approval.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      buildSessionId: { type: 'string', description: 'The open build session, when known.' },
      note: { type: 'string', description: 'What was edited, e.g. the artifact label.' },
    },
    required: ['note'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    await recordBuildArtifactEdited(ctx, input)
    return { recorded: true }
  },
} satisfies Tool<{ buildSessionId?: string; note: string }, { recorded: boolean }>)

registerTool({
  name: 'legal.assistant.settings_get',
  description:
    "The attorney's persisted assistant settings (model, effort, web-search/research, context depth) — per-attorney, stored through core. Null when never saved (the client uses its defaults).",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ settings: await getAssistantSettings(ctx) }),
} satisfies Tool<Record<string, never>, { settings: AssistantSettings | null }>)

registerTool({
  name: 'legal.assistant.settings_set',
  description:
    "Persist the attorney's assistant settings (whole payload; the client sends its full current settings object). Stored per-attorney through core — each save is a superseding attribute row, so the history is the audit trail.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      settings: {
        type: 'object',
        properties: {
          modelId: { type: 'string' },
          workRate: { type: 'string', enum: ['quick', 'balanced', 'thorough'] },
          webSearch: { type: 'boolean' },
          research: { type: 'boolean' },
          contextDepth: { type: 'string', enum: ['lean', 'balanced', 'generous'] },
        },
        additionalProperties: false,
      },
    },
    required: ['settings'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => setAssistantSettings(ctx, input.settings),
} satisfies Tool<{ settings: AssistantSettings }, { settingsEntityId: string }>)

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
    "Firm-wide AI token usage and ESTIMATED cost over the trailing window (sinceDays, default 30), broken down by model, by source (chat assistant vs document drafting), and by day. Reads token usage recorded on Claude assistant.turn (chat) and draft.generate (drafting) events; Perplexity turns don't report tokens. Cost is an estimate from list prices. Powers the Settings → AI usage tab.",
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
