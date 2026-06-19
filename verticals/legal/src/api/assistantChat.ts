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
  type WorkRate,
} from '../adapters/claude.js'
import { runPerplexityResearch, streamPerplexityResearch } from '../adapters/perplexity.js'
import { resolveAssistantModel, type AssistantProvider } from './assistantModels.js'
import {
  buildMatterAssistantContext,
  buildContactAssistantContext,
  type AssistantContext,
} from './assistantContext.js'

export type AssistantTurnKind = 'question' | 'research' | 'feedback'
export type AssistantScope = 'matter' | 'contact' | 'global'
// Beta-feedback category (Obj 11): the attorney tags feedback so the team can
// triage by area. Only meaningful for feedback turns.
export type FeedbackCategory = 'ui' | 'ai' | 'workflow' | 'other'

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
}

const SYSTEM_PROMPT = [
  "You are the AI assistant inside Pacheco Law's practice app — a tool for a solo/small NC business-law firm.",
  'Help the attorney work: explain and use the app (intake, booking, drafting, review, Granola import, settings), summarize and answer questions about the matter or client in context, and draft internal text when asked.',
  'When matter or client context is provided below, ground your answers in it.',
  "You are a drafting and workflow aid, not the attorney's legal judgment: when asked for a legal conclusion, give your best analysis but remind the attorney to verify it and that they own the legal opinion.",
  'You also collect product feedback: if the attorney shares a complaint, idea, or praise, acknowledge it warmly and note it has been recorded for the team.',
  'Keep replies focused and concise.',
].join(' ')

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
    if (input.matterEntityId) {
      return {
        scope: 'matter',
        context: await buildMatterAssistantContext(ctx, input.matterEntityId),
        primaryEntityId: input.matterEntityId,
      }
    }
    if (input.contactEntityId) {
      return {
        scope: 'contact',
        context: await buildContactAssistantContext(ctx, input.contactEntityId),
        primaryEntityId: input.contactEntityId,
      }
    }
  }
  return { scope: 'global', context: null, primaryEntityId: null }
}

// Web search is engaged when the toggle is on (for models that support it) or
// when the model always searches the web (Perplexity).
function webSearchOn(
  model: { supportsWebSearch: boolean; webSearchInherent: boolean },
  toggle: boolean | undefined,
): boolean {
  return model.webSearchInherent || (model.supportsWebSearch && !!toggle)
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
  const webSearch = webSearchOn(model, input.webSearch)

  let reply: string
  let citations: string[] = []

  if (model.provider === 'perplexity') {
    // External research: only the non-confidential framing leaves the firm.
    const result = await runPerplexityResearch(ctx.tenantId, {
      question: message,
      context: context?.framing,
      model: model.model,
    })
    reply = result.answer
    citations = result.citations
  } else {
    // Claude: full matter context is safe (the firm's own model).
    const system = context ? `${SYSTEM_PROMPT}\n\n--- Context ---\n${context.full}` : SYSTEM_PROMPT
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...(input.history ?? []),
      { role: 'user', content: message },
    ]
    const result = await chatWithAssistantDetailed(ctx.tenantId, messages, {
      model: model.model,
      workRate: input.workRate,
      supportsWorkRate: model.supportsWorkRate,
      webSearch,
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
  const webSearch = webSearchOn(model, input.webSearch)

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
    // Claude: full matter context is safe (the firm's own model).
    const system = context ? `${SYSTEM_PROMPT}\n\n--- Context ---\n${context.full}` : SYSTEM_PROMPT
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      ...(input.history ?? []),
      { role: 'user', content: message },
    ]
    for await (const chunk of streamChatWithAssistant(ctx.tenantId, messages, {
      model: model.model,
      workRate: input.workRate,
      supportsWorkRate: model.supportsWorkRate,
      webSearch,
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
      return [
        { ...base, role: 'user' as const, message: r.payload.message ?? '', reply: '' },
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
