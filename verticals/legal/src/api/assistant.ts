import { submitAction, type ActionContext } from '@exsto/substrate'
import { chatWithAssistant, type ChatMessage } from '../adapters/claude.js'
import { resolveModelForTask } from '../lib/modelRouter.js'

// The page the attorney was on when they opened the assistant, plus an optional
// intent flag the widget sets (e.g. a "Leave feedback" entry point). Kept open
// (Record) so the widget can attach more context later without an API change.
export interface AssistantPageContext {
  path?: string
  intent?: 'feedback' | 'question'
  [key: string]: unknown
}

export interface AskAssistantInput {
  message: string
  // Prior turns of THIS conversation, oldest-first. The system prompt is added
  // server-side, so callers pass user/assistant turns only.
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  pageContext?: AssistantPageContext
}

export interface AssistantReply {
  reply: string
}

// Concise system prompt for the Pacheco Law beta assistant. It helps the
// attorney USE the app and explicitly invites feedback; it must NOT give legal
// advice (this is a tool-usage helper, not a lawyer) and keeps replies short.
const SYSTEM_PROMPT = [
  'You are the in-app assistant for the Pacheco Law beta — a legal practice tool for a solo/small NC business-law firm.',
  'Help the attorney USE the app: intake, consultation booking, drafting, review, Granola call import, and settings.',
  'You also collect product feedback: when the attorney shares a complaint, idea, or praise, acknowledge it warmly and let them know it has been recorded for the team. Invite feedback when it fits naturally.',
  'Do NOT give legal advice, draft legal language, or opine on the merits of any matter — you are a tool-usage helper, not a lawyer. If asked for legal advice, say that is outside what you can help with here.',
  'Keep replies short and direct — a few sentences at most. No preamble.',
].join(' ')

// Heuristic: is this turn product feedback rather than a how-do-I question?
// The widget's explicit intent wins; otherwise a light keyword sniff. Kept
// deliberately simple — misclassification only affects the stored `kind` tag,
// not behavior, and the full text is always retained for later re-reading.
function classifyKind(
  message: string,
  pageContext?: AssistantPageContext,
): 'feedback' | 'question' {
  if (pageContext?.intent === 'feedback') return 'feedback'
  if (pageContext?.intent === 'question') return 'question'
  const m = message.toLowerCase()
  const looksLikeFeedback =
    /\b(feedback|bug|broken|doesn'?t work|not working|love|hate|wish|suggestion|suggest|annoying|confusing|should be able|would be (nice|great)|please add|missing)\b/.test(
      m,
    )
  return looksLikeFeedback ? 'feedback' : 'question'
}

// Substrate recording half — split out from askAssistant so the recording is
// testable without a live Claude key. Records one assistant exchange (the
// attorney's message + the assistant's reply) as a feedback.recorded event with
// provenance human:actorId. NO direct DB writes — everything via the action
// layer (event.record), per the substrate invariant.
export async function recordFeedback(
  ctx: ActionContext,
  input: {
    message: string
    reply: string
    pageContext?: AssistantPageContext
    kind: 'feedback' | 'question'
  },
): Promise<{ eventId: string }> {
  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'feedback.recorded',
      // Feedback is about the app, not any one matter — no primary entity.
      primary_entity_id: null,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        message: input.message,
        reply: input.reply,
        page_context: input.pageContext ?? {},
        kind: input.kind,
      },
    },
  })
  // event.record returns { eventId } as its single effect.
  const eventId = (res.effects[0] as { eventId: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}

// Ask the in-app assistant a question or leave feedback. Calls Claude with the
// system prompt + prior turns + this message, records the exchange to the
// substrate, and returns the reply. The recording is best-effort relative to the
// reply: the attorney gets an answer even if we somehow could not persist it,
// but persistence runs first so a failure surfaces rather than silently dropping
// feedback.
export async function askAssistant(
  ctx: ActionContext,
  input: AskAssistantInput,
): Promise<AssistantReply> {
  const message = input.message.trim()
  if (!message) throw new Error('Type a message first.')

  const history = input.history ?? []
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: message },
  ]

  // AI-CONTEXT C1 — tags this legacy in-app-help chat as chat_turn so it goes
  // through the router (behavior unchanged: chat_turn's registry default is
  // the same sonnet value this call used to get from the adapter's now-removed
  // DEFAULT_MODEL fallback).
  const reply = await chatWithAssistant(
    ctx.tenantId,
    messages,
    resolveModelForTask('chat_turn').model,
  )

  const kind = classifyKind(message, input.pageContext)
  await recordFeedback(ctx, { message, reply, pageContext: input.pageContext, kind })

  return { reply }
}
