// Unified assistant chat (replaces the per-matter "Ask Perplexity" research
// panel and the global beta-feedback chat). ONE chat the attorney can:
//   • point at any connected AI model (Claude / Perplexity) — model switching,
//   • have automatically pick up the matter or client they're working in, and
//   • leave beta feedback in (feedback turns are classified and recorded).
//
// Every exchange is persisted as an assistant.turn event (migration 0017) via
// the action layer — matter/contact-scoped turns thread on that entity's
// timeline; global turns (the FAB) are tenant-scoped with no primary entity.
//
// PROVIDER PRIVACY: Claude (the firm's own model) receives the FULL matter
// context; Perplexity (external research) receives only a non-confidential
// framing — client PII never leaves the firm through a third-party call. See
// assistantContext.ts.
import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'
import {
  chatWithAssistantDetailed,
  streamChatWithAssistant,
  type ChatMessage,
  type ClientTool,
  type WorkRate,
} from '../adapters/claude.js'
import { runPerplexityResearch, streamPerplexityResearch } from '../adapters/perplexity.js'
import { resolveAssistantModel, type AssistantProvider } from './assistantModels.js'
import {
  buildMatterAssistantContext,
  buildContactAssistantContext,
  parseContextDepth,
  type AssistantContext,
  type ContextDepth,
} from './assistantContext.js'
import { getMatter } from '../queries/matters.js'
import { getContact } from '../queries/contacts.js'

export type AssistantTurnKind = 'question' | 'research' | 'feedback'
export type AssistantScope = 'matter' | 'contact' | 'global'
// Beta-feedback category (Obj 11): the attorney tags feedback so the team can
// triage by area. Only meaningful for feedback turns. 'feature' = a request for
// something new (vs 'workflow' = a problem with an existing flow).
export type FeedbackCategory = 'ui' | 'ai' | 'workflow' | 'feature' | 'other'

export interface AssistantChatInput {
  message: string
  // `${provider}:${model}` from listAssistantModels (e.g. 'anthropic:claude-sonnet-4-6').
  modelId: string
  // Prior user/assistant turns of THIS conversation, oldest-first.
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  // At most one scope; both omitted = a global (feedback / how-do-I) chat.
  matterEntityId?: string
  contactEntityId?: string
  // The attorney's chat-settings work rate (effort/thinking). Default 'balanced'.
  workRate?: WorkRate
  // Web-search toggle from chat settings. Honoured for Claude (adds the native
  // web_search tool); Perplexity always searches regardless.
  webSearch?: boolean
  // Context toggle: when false, the turn is treated as a GENERAL message — not
  // grounded in (or threaded on) the current matter/client. Default true, so the
  // assistant is always contextualised to what the attorney is working on.
  useContext?: boolean
  // How much matter/client history to feed the model (chat settings). More depth
  // = richer grounding but a larger, slower, pricier prompt. Default 'balanced'.
  contextDepth?: ContextDepth
  // Documents the attorney attached to THIS message — uploaded files (parsed to
  // text upstream) or a matter document. Appended to the user message for CLAUDE
  // ONLY (the firm's own model); never sent to an external research model. Capped
  // server-side by composeUserMessage.
  attachments?: Array<{ name: string; text: string }>
  // Optional widget hint: a "Leave feedback" entry point forces kind='feedback'.
  intent?: 'feedback' | 'question'
  // Beta feedback (Obj 11): the category the attorney tagged + where they were.
  category?: FeedbackCategory
  pageContext?: { path?: string; [k: string]: unknown }
}

// One event of a streamed assistant turn, sent to the chat UI over SSE. `meta`
// lands first (so the UI can show the model + a "cites sources" hint), then
// thinking/text deltas, then a terminal `done` carrying the persisted eventId
// and the final citation list.
export type AssistantChatStreamEvent =
  | {
      type: 'meta'
      provider: AssistantProvider
      model: string
      kind: AssistantTurnKind
      scope: AssistantScope
      webSearch: boolean
    }
  | { type: 'thinking'; text: string }
  | { type: 'text'; text: string }
  | {
      type: 'done'
      eventId: string
      reply: string
      citations: string[]
      provider: AssistantProvider
      model: string
      kind: AssistantTurnKind
      scope: AssistantScope
    }

export interface AssistantChatReply {
  eventId: string
  reply: string
  citations: string[]
  provider: AssistantProvider
  model: string
  kind: AssistantTurnKind
  scope: AssistantScope
}

export interface AssistantThreadEntry {
  eventId: string
  role: 'user' | 'assistant'
  message: string
  reply: string
  provider: string
  model: string
  kind: AssistantTurnKind
  citations: string[]
  recordedAt: string
  // Names of documents attached to this turn (on the user side), so a reopened
  // thread still shows what was attached.
  attachmentNames?: string[]
}

const SYSTEM_PROMPT = [
  "You are the AI assistant inside Pacheco Law's practice app — a tool for a solo/small NC business-law firm.",
  'Help the attorney work: explain and use the app (intake, booking, drafting, review, Granola import, settings), summarize and answer questions about the matter or client in context, and draft internal text when asked.',
  'When matter or client context is provided below, ground your answers in it.',
  // Linking: replies render markdown, so [label](path) becomes a clickable in-app
  // link. Point the attorney to the right page instead of just naming it.
  'When you point the attorney to a part of the app, LINK to it with a markdown link they can click. Main pages: Dashboard (/attorney), Matters (/attorney/matters), Clients (/attorney/crm), Contacts (/attorney/crm/contacts), Calendar (/attorney/calendar), Mail (/attorney/mail), Services (/attorney/services), Templates (/attorney/templates), Questionnaires (/attorney/questionnaires), Billing (/attorney/billing), Review queue (/attorney/review), Settings (/attorney/settings). Only link to these paths or links given in the context below; never invent entity ids.',
  "You are a drafting and workflow aid, not the attorney's legal judgment: when asked for a legal conclusion, give your best analysis but remind the attorney to verify it and that they own the legal opinion.",
  'You also collect product feedback. When the attorney shares a complaint, idea, or praise: if it is vague or missing actionable detail (which screen, what they expected, the steps to reproduce), ask ONE short clarifying question first. Once you have a clear, specific item, CALL the log_feedback tool to file it with the right category, then tell the attorney it is logged and share the reference id the tool returns. Use the tool only for genuine product feedback, not for ordinary questions.',
  'Keep replies focused and concise.',
].join(' ')

// Definition advertised to the model for the log_feedback client tool. The
// assistant calls it to file a clean, triageable feedback item (vs. the passive
// keyword capture of every turn). Executed by buildFeedbackTool below.
const LOG_FEEDBACK_TOOL_DEF = {
  name: 'log_feedback',
  description:
    'Record a piece of product feedback (a bug, complaint, idea, or praise about THIS app) so the product team sees it as a clean item. Only call once you have a specific, actionable summary — if the attorney was vague, ask one clarifying question first. Returns a reference id to share back.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description:
          'The feedback as a clear standalone item: what, where (which screen), and expected vs actual when relevant.',
      },
      category: {
        type: 'string',
        enum: ['ui', 'ai', 'workflow', 'feature', 'other'],
        description:
          "Which area the feedback concerns. Use 'feature' when the attorney is asking for something NEW (a feature or workflow they wish existed); 'workflow' when an existing flow is clumsy or broken.",
      },
    },
    required: ['summary'],
    additionalProperties: false,
  },
}

// Build the log_feedback ClientTool for this turn. Its run() records the feedback
// through the SAME action-layer path as the Beta button (submitAssistantFeedback),
// threaded on the current matter/contact, and returns the reference id to the
// model. No direct substrate writes — everything via the action layer.
function buildFeedbackTool(ctx: ActionContext, input: AssistantChatInput): ClientTool {
  return {
    definition: LOG_FEEDBACK_TOOL_DEF,
    name: 'log_feedback',
    run: async (raw) => {
      const args = (raw ?? {}) as { summary?: string; category?: FeedbackCategory }
      const summary = (args.summary ?? '').trim()
      if (!summary) return 'No feedback summary was provided, so nothing was logged.'
      const { eventId } = await submitAssistantFeedback(ctx, {
        message: summary,
        category: args.category,
        matterEntityId: input.matterEntityId,
        contactEntityId: input.contactEntityId,
        pageContext: input.pageContext,
      })
      return `Feedback logged for the team. Reference id: ${eventId}.`
    },
  }
}

// Build the Claude system text: the base prompt + the matter/client context, plus
// where the attorney is in the app — the exact route they're on (so "this page",
// "here", "this screen" resolve), and the current entity's in-app link so the
// assistant can refer them back to it. The route names map to the page list in
// SYSTEM_PROMPT, so the model can speak about the screen naturally. Claude is the
// firm's own model, so the route/id is safe; the external research path never
// receives it.
function buildClaudeSystem(
  scope: AssistantScope,
  primaryEntityId: string | null,
  context: AssistantContext | null,
  pageContext?: { path?: string; [k: string]: unknown } | null,
): string {
  let system = context ? `${SYSTEM_PROMPT}\n\n--- Context ---\n${context.full}` : SYSTEM_PROMPT
  const currentPath =
    typeof pageContext?.path === 'string' && pageContext.path ? pageContext.path : null
  if (currentPath) {
    system += `\n\nThe attorney is currently on ${currentPath}. When they say "this page", "here", or "this screen", they mean that route — ground your answer in it and link back to it with a markdown link when relevant.`
  }
  const entityPath =
    primaryEntityId && scope === 'matter'
      ? `/attorney/matters/${primaryEntityId}`
      : primaryEntityId && scope === 'contact'
        ? `/attorney/crm/contacts/${primaryEntityId}`
        : null
  if (entityPath && entityPath !== currentPath) {
    system += `\n\nThis conversation is about the ${scope} at ${entityPath} — link to it with a markdown link when referring the attorney back to it.`
  }
  return system
}

// Caps so an attached document can't blow the context window (or the bill): per
// attachment, and across all attachments in one turn. Generous enough for a long
// contract; oversized text is truncated with a marker.
const MAX_ATTACHMENT_CHARS = 60_000
const MAX_ATTACHMENTS_TOTAL_CHARS = 160_000

// Append the attorney's attached documents to their message (Claude only). Each
// document is delimited and labelled; total size is bounded. Returns the message
// unchanged when there are no attachments.
function composeUserMessage(
  message: string,
  attachments: AssistantChatInput['attachments'],
): string {
  if (!attachments || attachments.length === 0) return message
  let budget = MAX_ATTACHMENTS_TOTAL_CHARS
  const sections: string[] = []
  for (const a of attachments) {
    if (budget <= 0) break
    const name = (a.name || 'document').slice(0, 200)
    let body = (a.text ?? '').trim()
    if (!body) continue
    let truncated = false
    const cap = Math.min(MAX_ATTACHMENT_CHARS, budget)
    if (body.length > cap) {
      body = body.slice(0, cap)
      truncated = true
    }
    budget -= body.length
    sections.push(`[Attached document: ${name}]\n${body}${truncated ? '\n…(truncated)' : ''}`)
  }
  if (sections.length === 0) return message
  return `${message}\n\n--- Attached documents (provided by the attorney for this question) ---\n\n${sections.join('\n\n')}`
}

// Heuristic feedback sniff (mirrors the legacy assistant). Perplexity turns are
// always 'research'; an explicit widget intent wins; otherwise a keyword check.
function classifyKind(
  provider: AssistantProvider,
  message: string,
  intent?: 'feedback' | 'question',
): AssistantTurnKind {
  if (provider === 'perplexity') return 'research'
  if (intent === 'feedback') return 'feedback'
  if (intent === 'question') return 'question'
  const m = message.toLowerCase()
  const looksLikeFeedback =
    /\b(feedback|bug|broken|doesn'?t work|not working|love|hate|wish|suggestion|suggest|annoying|confusing|should be able|would be (nice|great)|please add|missing)\b/.test(
      m,
    )
  return looksLikeFeedback ? 'feedback' : 'question'
}

async function loadContext(
  ctx: ActionContext,
  input: AssistantChatInput,
): Promise<{
  scope: AssistantScope
  context: AssistantContext | null
  primaryEntityId: string | null
}> {
  // Context toggle off ⇒ a deliberately GENERAL message: no grounding, and not
  // threaded on the matter/client (recorded globally), so it doesn't pollute the
  // entity's timeline. Default (true) keeps the assistant contextualised.
  if (input.useContext !== false) {
    // Normalize the depth from (untrusted) chat settings before it reaches the
    // budget lookup.
    const depth = parseContextDepth(input.contextDepth)
    if (input.matterEntityId) {
      return {
        scope: 'matter',
        context: await buildMatterAssistantContext(ctx, input.matterEntityId, depth),
        primaryEntityId: input.matterEntityId,
      }
    }
    if (input.contactEntityId) {
      return {
        scope: 'contact',
        context: await buildContactAssistantContext(ctx, input.contactEntityId, depth),
        primaryEntityId: input.contactEntityId,
      }
    }
  }
  return { scope: 'global', context: null, primaryEntityId: null }
}

// Web search is engaged when the toggle is on (for models that support it) or
// when the model always searches the web (Perplexity).
//
// SECURITY GATE: a grounded turn injects the FULL matter/client context — client
// names, emails, and (at higher depths) email bodies and call transcripts — into
// Claude's prompt. Anthropic's server-side web_search could put that privileged
// content into outbound search queries, so web_search is NEVER enabled on a
// grounded Claude turn. Perplexity is unaffected: it only ever receives the
// non-confidential framing, so its inherent search stays on. The attorney can turn
// the context toggle off (ask a general question) to use web search.
export function webSearchOn(
  model: { supportsWebSearch: boolean; webSearchInherent: boolean },
  toggle: boolean | undefined,
  grounded: boolean,
): boolean {
  if (model.webSearchInherent) return true
  if (grounded) return false
  return model.supportsWebSearch && !!toggle
}

// Substrate recording half — split out so the persistence is testable without a
// live model key. Records one exchange as an assistant.turn event through the
// action layer (event.record). Matter/contact-scoped turns set primary_entity_id
// so they thread on that entity's timeline; global turns leave it null.
export async function recordAssistantTurn(
  ctx: ActionContext,
  input: {
    message: string
    reply: string
    provider: AssistantProvider
    model: string
    kind: AssistantTurnKind
    citations: string[]
    scope: AssistantScope
    primaryEntityId: string | null
    // Feedback turns (Obj 11): the tagged category + the page the attorney was on.
    category?: FeedbackCategory | null
    pageContext?: Record<string, unknown> | null
    // Names of any documents the attorney attached to this turn (names only — the
    // text already shaped the reply; keeping it out of the event avoids bloat).
    attachmentNames?: string[] | null
  },
): Promise<{ eventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: input.kind === 'feedback' ? 'reflection' : 'exploration',
    payload: {
      event_kind_name: 'assistant.turn',
      primary_entity_id: input.primaryEntityId,
      // Research provenance is the external provider; conversational/feedback
      // turns are the attorney speaking to their own assistant.
      source_type: input.provider === 'perplexity' ? 'integration' : 'human',
      source_ref: input.provider === 'perplexity' ? 'integration:perplexity' : ctx.actorId,
      data: {
        message: input.message,
        reply: input.reply,
        provider: input.provider,
        model: input.model,
        kind: input.kind,
        citations: input.citations,
        scope: input.scope,
        // Only feedback carries a category; default 'other' so triage never sees null.
        category: input.kind === 'feedback' ? (input.category ?? 'other') : null,
        page_context: input.pageContext ?? null,
        attachment_names: input.attachmentNames ?? null,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// Send a message to the chosen model with the matter/client context injected,
// then record the exchange. Returns the reply (+ citations for research models).
export async function assistantChat(
  ctx: ActionContext,
  input: AssistantChatInput,
): Promise<AssistantChatReply> {
  const message = input.message.trim()
  if (!message) throw new Error('Type a message first.')

  const model = resolveAssistantModel(input.modelId)
  if (!model) throw new Error(`Unknown model: ${input.modelId}`)
  if (!model.available) {
    throw new Error(`${model.providerLabel} chat isn't available yet — pick Claude or Perplexity.`)
  }

  const { scope, context, primaryEntityId } = await loadContext(ctx, input)
  const kind = classifyKind(model.provider, message, input.intent)
  // Attachments (Claude only) carry potentially-confidential text in the prompt,
  // so they gate web search off for the same reason a grounded turn does — the
  // attached text must never reach an outbound web_search query.
  const hasAttachments = (input.attachments?.length ?? 0) > 0
  const webSearch = webSearchOn(model, input.webSearch, Boolean(context) || hasAttachments)

  let reply: string
  let citations: string[] = []

  if (model.provider === 'perplexity') {
    // External research: only the non-confidential framing leaves the firm —
    // attachments (which may hold client documents) are deliberately NOT sent.
    const result = await runPerplexityResearch(ctx.tenantId, {
      question: message,
      context: context?.framing,
      model: model.model,
    })
    reply = result.answer
    citations = result.citations
  } else {
    // Claude: full matter context is safe (the firm's own model), as are any
    // attached documents — appended to the user message.
    const system = buildClaudeSystem(scope, primaryEntityId, context, input.pageContext)
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...(input.history ?? []),
      { role: 'user', content: composeUserMessage(message, input.attachments) },
    ]
    const result = await chatWithAssistantDetailed(ctx.tenantId, messages, {
      model: model.model,
      workRate: input.workRate,
      supportsWorkRate: model.supportsWorkRate,
      webSearch,
      clientTools: [buildFeedbackTool(ctx, input)],
    })
    reply = result.reply
    citations = result.citations
  }

  const { eventId } = await recordAssistantTurn(ctx, {
    message,
    reply,
    provider: model.provider,
    model: model.model,
    kind,
    citations,
    scope,
    primaryEntityId,
    category: input.category ?? null,
    pageContext: input.pageContext ?? null,
    attachmentNames: input.attachments?.map((a) => a.name) ?? null,
  })

  return { eventId, reply, citations, provider: model.provider, model: model.model, kind, scope }
}

// Streaming counterpart of assistantChat: yields meta → thinking/text deltas →
// done, recording the assistant.turn event (through the action layer) once the
// model finishes. The reply is assembled here from the deltas, so persistence
// stays identical to the non-streaming path — the stream is just transport.
export async function* assistantChatStream(
  ctx: ActionContext,
  input: AssistantChatInput,
): AsyncGenerator<AssistantChatStreamEvent> {
  const message = input.message.trim()
  if (!message) throw new Error('Type a message first.')

  const model = resolveAssistantModel(input.modelId)
  if (!model) throw new Error(`Unknown model: ${input.modelId}`)
  if (!model.available) {
    throw new Error(`${model.providerLabel} chat isn't available yet — pick Claude or Perplexity.`)
  }

  const { scope, context, primaryEntityId } = await loadContext(ctx, input)
  const kind = classifyKind(model.provider, message, input.intent)
  // See assistantChat: attachments gate web search off (their text must not leak
  // into an outbound web_search query).
  const hasAttachments = (input.attachments?.length ?? 0) > 0
  const webSearch = webSearchOn(model, input.webSearch, Boolean(context) || hasAttachments)

  yield { type: 'meta', provider: model.provider, model: model.model, kind, scope, webSearch }

  let reply = ''
  let citations: string[] = []

  if (model.provider === 'perplexity') {
    // External research: only the non-confidential framing leaves the firm.
    for await (const chunk of streamPerplexityResearch(ctx.tenantId, {
      question: message,
      context: context?.framing,
      model: model.model,
    })) {
      if (chunk.type === 'text') {
        reply += chunk.text
        yield { type: 'text', text: chunk.text }
      } else if (chunk.type === 'citations') {
        citations = chunk.citations
      }
    }
  } else {
    // Claude: full matter context is safe (the firm's own model), as are any
    // attached documents — appended to the user message.
    const system = buildClaudeSystem(scope, primaryEntityId, context, input.pageContext)
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...(input.history ?? []),
      { role: 'user', content: composeUserMessage(message, input.attachments) },
    ]
    for await (const chunk of streamChatWithAssistant(ctx.tenantId, messages, {
      model: model.model,
      workRate: input.workRate,
      supportsWorkRate: model.supportsWorkRate,
      webSearch,
      clientTools: [buildFeedbackTool(ctx, input)],
    })) {
      if (chunk.type === 'text') {
        reply += chunk.text
        yield { type: 'text', text: chunk.text }
      } else if (chunk.type === 'thinking') {
        yield { type: 'thinking', text: chunk.text }
      } else if (chunk.type === 'citations') {
        citations = chunk.citations
      }
    }
  }

  const { eventId } = await recordAssistantTurn(ctx, {
    message,
    reply,
    provider: model.provider,
    model: model.model,
    kind,
    citations,
    scope,
    primaryEntityId,
    category: input.category ?? null,
    pageContext: input.pageContext ?? null,
    attachmentNames: input.attachments?.map((a) => a.name) ?? null,
  })

  yield {
    type: 'done',
    eventId,
    reply,
    citations,
    provider: model.provider,
    model: model.model,
    kind,
    scope,
  }
}

export interface SubmitFeedbackInput {
  message: string
  category?: FeedbackCategory
  // Where the attorney was (path + a section label) when they hit the Beta button.
  pageContext?: { path?: string; section?: string; [k: string]: unknown }
  // If the attorney was on a matter/client, thread the feedback there too.
  matterEntityId?: string
  contactEntityId?: string
}

// Dedicated beta-feedback capture (the Beta button). Unlike a chat turn this
// makes NO model call — it just records the attorney's message as a feedback
// assistant.turn event (kind='feedback') with its category + the exact page/
// section they were on, straight onto the substrate via the action layer.
export async function submitAssistantFeedback(
  ctx: ActionContext,
  input: SubmitFeedbackInput,
): Promise<{ eventId: string }> {
  const message = input.message.trim()
  if (!message) throw new Error('Tell us what you think first.')
  const primaryEntityId = input.matterEntityId ?? input.contactEntityId ?? null
  const scope: AssistantScope = input.matterEntityId
    ? 'matter'
    : input.contactEntityId
      ? 'contact'
      : 'global'
  return recordAssistantTurn(ctx, {
    message,
    reply: '',
    // Feedback is the attorney speaking to their own team — provenance human,
    // no model involved (recordAssistantTurn keys provenance off provider).
    provider: 'anthropic',
    model: '',
    kind: 'feedback',
    citations: [],
    scope,
    primaryEntityId,
    category: input.category ?? 'other',
    pageContext: input.pageContext ?? null,
  })
}

// Prior turns for a scope, oldest-first (conversation order), so reopening a
// matter's chat shows its history. A matter/contact id reads that entity's
// thread; omitting both reads the global (feedback) thread.
export async function listAssistantThread(
  ctx: ActionContext,
  scope: { matterEntityId?: string; contactEntityId?: string },
): Promise<AssistantThreadEntry[]> {
  const primary = scope.matterEntityId ?? scope.contactEntityId ?? null
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: {
        message?: string
        reply?: string
        provider?: string
        model?: string
        kind?: AssistantTurnKind
        citations?: string[]
        attachment_names?: string[] | null
      }
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'assistant.turn'
         AND e.primary_entity_id IS NOT DISTINCT FROM $2::uuid
         AND COALESCE(e.payload->>'kind', '') <> 'feedback'
       ORDER BY e.occurred_at ASC`,
      [ctx.tenantId, primary],
    )
    return res.rows.flatMap((r) => {
      const base = {
        eventId: r.event_id,
        provider: r.payload.provider ?? '',
        model: r.payload.model ?? '',
        kind: r.payload.kind ?? 'question',
        citations: r.payload.citations ?? [],
        recordedAt: r.occurred_at,
      }
      // One stored exchange expands to two display turns (user then assistant).
      // Attachment names ride on the user side (that's where they were attached).
      return [
        {
          ...base,
          role: 'user' as const,
          message: r.payload.message ?? '',
          reply: '',
          attachmentNames: r.payload.attachment_names ?? undefined,
        },
        { ...base, role: 'assistant' as const, message: '', reply: r.payload.reply ?? '' },
      ]
    })
  })
}

export interface AssistantFeedbackEntry {
  eventId: string
  message: string
  category: FeedbackCategory
  pageContext: Record<string, unknown> | null
  recordedAt: string
}

// All beta-feedback turns, newest-first, with category + page context — the
// triage surface (Obj 11). Tenant-scoped read of assistant.turn events tagged
// kind='feedback'.
export async function listAssistantFeedback(ctx: ActionContext): Promise<AssistantFeedbackEntry[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: {
        message?: string
        category?: FeedbackCategory
        page_context?: Record<string, unknown> | null
      }
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'assistant.turn'
         AND e.payload->>'kind' = 'feedback'
       ORDER BY e.occurred_at DESC`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      eventId: r.event_id,
      message: r.payload.message ?? '',
      category: r.payload.category ?? 'other',
      pageContext: r.payload.page_context ?? null,
      recordedAt: r.occurred_at,
    }))
  })
}

export interface AssistantThreadSummary {
  scope: AssistantScope
  matterEntityId?: string
  contactEntityId?: string
  // Human label for the picker ("Matter 2025-014" / "Acme LLC" / "App help").
  label: string
  // First ~100 chars of the most recent question in the thread.
  snippet: string
  lastMessageAt: string
  count: number
}

// The attorney's prior assistant conversations, grouped by scope (one row per
// matter/contact, plus the global app-help thread), most-recent-activity first —
// powers the history picker so they can reopen a chat on a different matter.
// Feedback turns are excluded (they have their own triage surface). Tenant-scoped;
// entity labels are resolved best-effort and bounded by the LIMIT.
export async function listAssistantThreads(ctx: ActionContext): Promise<AssistantThreadSummary[]> {
  const rows = await withActionContext(ctx, async (client) => {
    const res = await client.query<{
      entity_id: string | null
      entity_kind: string | null
      turn_count: number
      last_at: string
      last_message: string | null
    }>(
      `SELECT e.primary_entity_id AS entity_id,
              ekd2.kind_name      AS entity_kind,
              count(*)::int       AS turn_count,
              to_char(max(e.occurred_at), 'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_at,
              (array_agg(e.payload->>'message' ORDER BY e.occurred_at DESC))[1] AS last_message
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       LEFT JOIN entity ent ON ent.id = e.primary_entity_id
       LEFT JOIN entity_kind_definition ekd2 ON ekd2.id = ent.entity_kind_id
       WHERE e.tenant_id = $1 AND ekd.kind_name = 'assistant.turn'
         AND COALESCE(e.payload->>'kind', '') <> 'feedback'
       GROUP BY e.primary_entity_id, ekd2.kind_name
       ORDER BY max(e.occurred_at) DESC
       LIMIT 30`,
      [ctx.tenantId],
    )
    return res.rows
  })

  const summaries: AssistantThreadSummary[] = []
  for (const r of rows) {
    const snippet = (r.last_message ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)
    const base = { snippet, lastMessageAt: r.last_at, count: r.turn_count }
    if (!r.entity_id) {
      summaries.push({ scope: 'global', label: 'App help', ...base })
    } else if (r.entity_kind === 'matter') {
      const m = await getMatter(ctx, r.entity_id).catch(() => null)
      summaries.push({
        scope: 'matter',
        matterEntityId: r.entity_id,
        label: m ? `Matter ${m.matterNumber}` : 'Matter',
        ...base,
      })
    } else if (r.entity_kind === 'client_contact') {
      const c = await getContact(ctx, r.entity_id).catch(() => null)
      summaries.push({
        scope: 'contact',
        contactEntityId: r.entity_id,
        label: c?.fullName || c?.companyName || 'Client',
        ...base,
      })
    }
    // Any other entity kind isn't a re-scopable chat target — skip it.
  }
  return summaries
}
