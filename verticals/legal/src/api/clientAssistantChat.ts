import type { ActionContext } from '@exsto/substrate'
import {
  streamChatWithAssistant,
  workRateParams,
  type AssistantStreamChunk,
  type ChatMessage,
  type ClientTool,
} from '../adapters/claude.js'
import { resolveModelForTask } from '../lib/modelRouter.js'
import { guardChatBudget } from '../lib/tokenGuard.js'
import { recordAssistantTurn } from './assistantChat.js'
import { collapseRoundStutter } from './replyAssembly.js'
import { getSkillBySlug } from '../queries/skills.js'
import { listClientMatters, getClientMatterTimeline } from '../queries/clientPortal.js'
import { listApprovedClientDocuments } from '../queries/clientDocuments.js'
import { getClientBillingSummary, listClientTodos } from './clientBillingSummary.js'
import { getMatterThread } from './clientMessaging.js'
import { resolveClientMatterIds } from './clientIdentity.js'
import { getPortalSchedulingAvailability, getSchedulingFeeQuote } from './portalScheduling.js'
import { quoteClientRequest, isRequestType, type RequestType } from './requestPricing.js'
import { listServices } from './services.js'
import { getTenantSettingsForMerge } from './tenantSettings.js'
import {
  ASK_DONT_GUESS,
  NO_INVENTED_MATTER_FACTS,
  REPLY_LANGUAGE,
  CHAT_VOICE,
  portalLocaleLine,
} from './assistantPrompt.js'

// PORTAL-1 (WP5) — the portal chatbot: same brain (the Claude adapter's chat
// loop + streaming + caching), DIFFERENT HANDS. The tool surface is built from
// scratch as an ALLOWLIST of client-safe closures; every tool closes over the
// session-resolved clientContactId + the client's own actor ctx, so nothing the
// MODEL sends can name another client, another matter, or an attorney surface.
// The client is an untrusted party: their messages are adversarial input, and
// the scoping lives in these tool implementations — never in the system prompt.
//
// The bot NEVER consents to a fee on the client's behalf: anything billable
// returns the quote and a `consent_required` marker; the UI renders the consent
// card and the CLIENT's own click fires the accept (law 2).

const MAX_MESSAGE_CHARS = 4_000
const MAX_HISTORY_TURNS = 12

// WP A2 — de-hardcoded from a literal "Pacheco Law" name: this bot serves
// EVERY tenant's client portal, so a hardcoded firm name here would name
// Pacheco Law inside another firm's portal. Read via getTenantSettingsForMerge
// (never getTenantSettings/FIRM_DEFAULTS) so an unset firm degrades to the
// honest generic "the firm", not the demo identity.
// Exported for the zero-Pacheco/NC test (tests/vertical/): pure string
// building, no DB, so an unset firm's portal prompt is directly assertable.
// WP A3 — the `locale` is the portal UI's current language (en/es), threaded in
// from the request so a Spanish-speaking client is greeted in Spanish rather than
// answered in English until they switch. The four shared discipline blocks
// (ask-vs-guess, no invented facts, reply language, chat voice) are imported from
// assistantPrompt.ts so both surfaces carry ONE canonical wording. Jurisdiction
// discipline is attorney-only — the portal bot does not draft or state law.
export function buildBaseSystem(firmName: string, locale?: 'en' | 'es'): string {
  return [
    `You are ${firmName}'s client portal assistant, chatting with a signed-in client of the firm.

Everything you can see comes from the tools, which are scoped to THIS client's own matters, documents, invoices, and messages. Use them; never guess or invent records. You cannot see other clients, firm internals, or anything the firm has not released.

You do not give legal advice, interpret the law for the client's situation, or promise outcomes or timelines. For legal questions, offer to file a request for the attorney or point them to scheduling time.

Anything with a cost must show its exact fee, and the client accepts it themselves in the portal — never treat a chat message as fee acceptance, and never imply something is free unless a tool said so.

When the client wants something new: if it matches a service the firm offers online, point them to book it. Otherwise gather what the firm needs (what they want, which matter it concerns, urgency) and use prepare_request — the request goes to the attorney's queue; the attorney's approval is what turns it into work.`,
    ASK_DONT_GUESS,
    NO_INVENTED_MATTER_FACTS,
    REPLY_LANGUAGE,
    portalLocaleLine(locale),
    CHAT_VOICE,
    'Keep replies short, warm, and in plain language.',
  ]
    .filter(Boolean)
    .join('\n\n')
}

export interface ClientChatIdentity {
  clientContactId: string
  displayName: string
  email: string
}

// The allowlisted client tool surface. Every closure re-derives scope from the
// session identity; ids arriving from the model are validated against the
// client's OWN matter set before any read.
function buildClientPortalTools(ctx: ActionContext, who: ClientChatIdentity): ClientTool[] {
  const asJson = (v: unknown): string => JSON.stringify(v)

  const assertOwnMatter = async (matterEntityId: string): Promise<void> => {
    const ids = await resolveClientMatterIds(ctx.tenantId, who.clientContactId)
    if (!ids.includes(matterEntityId)) {
      // Same shape as not-found — no oracle for other clients' matters.
      throw new Error('No such matter.')
    }
  }

  return [
    {
      name: 'get_my_matters',
      definition: {
        name: 'get_my_matters',
        description:
          "The client's own matters (including archived history) with client-safe status labels.",
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      run: async () => asJson(await listClientMatters(ctx, who.clientContactId)),
    },
    {
      name: 'get_matter_status',
      definition: {
        name: 'get_matter_status',
        description: 'Status + milestone timeline for ONE of the client’s own matters.',
        input_schema: {
          type: 'object',
          properties: { matterEntityId: { type: 'string' } },
          required: ['matterEntityId'],
          additionalProperties: false,
        },
      },
      run: async (input) => {
        const { matterEntityId } = input as { matterEntityId: string }
        await assertOwnMatter(matterEntityId)
        return asJson(await getClientMatterTimeline(ctx, matterEntityId))
      },
    },
    {
      name: 'get_my_documents',
      definition: {
        name: 'get_my_documents',
        description:
          'The documents the firm has released to the client (metadata only — the client reads them in the Documents tab).',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      run: async () => asJson(await listApprovedClientDocuments(ctx, who.clientContactId)),
    },
    {
      name: 'get_my_billing',
      definition: {
        name: 'get_my_billing',
        description:
          "The client's invoices (open + paid), accruing not-yet-invoiced fees, and running total. An unpaid invoice's pay link is /portal/pay/<invoiceNumber>.",
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      run: async () => asJson(await getClientBillingSummary(ctx, who.clientContactId)),
    },
    {
      name: 'get_my_todos',
      definition: {
        name: 'get_my_todos',
        description:
          'Everything currently waiting on the client: documents to sign, invoices to pay, requested materials.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      run: async () => asJson(await listClientTodos(ctx, who.clientContactId)),
    },
    {
      name: 'get_messages',
      definition: {
        name: 'get_messages',
        description: 'The message thread with the firm on ONE of the client’s own matters.',
        input_schema: {
          type: 'object',
          properties: { matterEntityId: { type: 'string' } },
          required: ['matterEntityId'],
          additionalProperties: false,
        },
      },
      run: async (input) => {
        const { matterEntityId } = input as { matterEntityId: string }
        await assertOwnMatter(matterEntityId)
        return asJson(await getMatterThread(ctx, matterEntityId))
      },
    },
    {
      name: 'get_bookable_services',
      definition: {
        name: 'get_bookable_services',
        description:
          'Services the firm offers for online booking (name, description, whether an appointment is required). Booking link: /book?service=<serviceKey>.',
        input_schema: { type: 'object', properties: {}, additionalProperties: false },
      },
      run: async () => {
        const services = await listServices(ctx)
        return asJson(
          services
            .filter((svc) => svc.bookable === true)
            .map((svc) => ({
              serviceKey: svc.serviceKey,
              displayName: svc.displayName,
              description: svc.description,
              appointmentRequired: svc.appointmentRequired,
              bookUrl: `/book?service=${encodeURIComponent(svc.serviceKey)}`,
            })),
        )
      },
    },
    {
      name: 'get_availability',
      definition: {
        name: 'get_availability',
        description: 'Open consultation slots on the firm’s live calendar.',
        input_schema: {
          type: 'object',
          properties: { durationMinutes: { type: 'number' } },
          additionalProperties: false,
        },
      },
      run: async (input) => {
        const { durationMinutes } = (input ?? {}) as { durationMinutes?: number }
        const availability = await getPortalSchedulingAvailability(ctx, { durationMinutes })
        // The model needs a digest, not 200 slots.
        return asJson({
          configured: availability.configured,
          timezone: availability.timezone,
          meetingLengthsMinutes: availability.meetingLengthsMinutes,
          nextSlots: availability.slots.slice(0, 10),
          scheduleTabHint:
            'The client books in the portal’s Book & Schedule tab (billable time shows a consent card there).',
        })
      },
    },
    {
      name: 'get_scheduling_fee',
      definition: {
        name: 'get_scheduling_fee',
        description:
          'Whether portal-scheduled time is billable for this client, and the rate × duration quote when it is (null = free).',
        input_schema: {
          type: 'object',
          properties: { durationMinutes: { type: 'number' } },
          additionalProperties: false,
        },
      },
      run: async (input) => {
        const { durationMinutes } = (input ?? {}) as { durationMinutes?: number }
        return asJson(await getSchedulingFeeQuote(ctx, who.clientContactId, durationMinutes ?? 30))
      },
    },
    {
      name: 'prepare_request',
      definition: {
        name: 'prepare_request',
        description:
          'Prepare a request to the firm once you have gathered what it needs. Returns the server-computed fee quote and a prefill; the CLIENT then confirms (and accepts any fee) on the request card the portal shows — you never file or accept on their behalf.',
        input_schema: {
          type: 'object',
          properties: {
            requestType: { type: 'string', enum: ['meeting', 'document', 'review'] },
            matterEntityId: { type: 'string' },
            description: { type: 'string' },
            durationMinutes: { type: 'number' },
          },
          required: ['requestType', 'matterEntityId', 'description'],
          additionalProperties: false,
        },
      },
      run: async (input) => {
        const p = input as {
          requestType: string
          matterEntityId: string
          description: string
          durationMinutes?: number
        }
        if (!isRequestType(p.requestType)) throw new Error('Unknown request type.')
        await assertOwnMatter(p.matterEntityId)
        const quote = await quoteClientRequest(ctx, {
          requestType: p.requestType as RequestType,
          durationMinutes: p.durationMinutes ?? null,
        })
        return asJson({
          consent_required: true,
          prefill: {
            requestType: p.requestType,
            matterEntityId: p.matterEntityId,
            description: p.description.slice(0, 2000),
            durationMinutes: quote.durationMinutes,
          },
          quote,
          note: 'Tell the client the exact fee and that a confirmation card has appeared — THEY confirm it; the firm reviews every request before any work starts.',
        })
      },
    },
  ]
}

export interface ClientChatStreamEvent {
  type: 'text' | 'thinking' | 'done' | 'error' | 'request_card'
  text?: string
  /** For request_card: the prefill + quote the UI renders as a consent card. */
  card?: Record<string, unknown>
}

export interface ClientChatInput {
  message: string
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  // WP A3 — the portal UI's current language, threaded through so the base
  // prompt can default a Spanish-speaking client to Spanish (portalLocaleLine).
  locale?: 'en' | 'es'
}

// Streaming client chat. ctx MUST carry the client's own actor (from the authed
// route); the assistant.turn event this records is therefore the client's own
// ledger row.
export async function* clientAssistantChatStream(
  ctx: ActionContext,
  who: ClientChatIdentity,
  input: ClientChatInput,
): AsyncGenerator<ClientChatStreamEvent> {
  const message = (input.message ?? '').trim().slice(0, MAX_MESSAGE_CHARS)
  if (!message) {
    yield { type: 'error', text: 'Say something and I will do my best to help.' }
    return
  }

  // The seeded skill is the bot's standing discipline; a missing skill row is a
  // configuration error we surface honestly rather than running unbounded.
  const skill = await getSkillBySlug(ctx, 'client-portal.portal-assistant')
  const firmSettings = await getTenantSettingsForMerge(ctx)
  const system = [
    buildBaseSystem(firmSettings.firmName ?? 'the firm', input.locale),
    skill?.body ? `--- Firm guidance ---\n${skill.body}` : '',
    `--- Client ---\nYou are talking to ${who.displayName} (${who.email}).`,
  ]
    .filter(Boolean)
    .join('\n\n')

  const history = (input.history ?? [])
    .slice(-MAX_HISTORY_TURNS)
    .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .map((h) => ({ role: h.role, content: h.content.slice(0, MAX_MESSAGE_CHARS) }))

  const tools = buildClientPortalTools(ctx, who)
  let reply = ''
  let requestCard: Record<string, unknown> | null = null
  // AI-CONTEXT C1 — was a literal 'claude-sonnet-4-6' pin (a workaround for the
  // LEGAL_DRAFTING_MODEL=''-not-unset gotcha, since that env var isn't even
  // consulted for chat_client_portal). Now the router's pinned default for this
  // task — byte-identical value, same reasoning, one fewer hardcoded model id.
  const model = resolveModelForTask('chat_client_portal').model

  // AI-CONTEXT C3 — pre-flight budget check. The portal bot's caps above
  // (MAX_MESSAGE_CHARS=4k, MAX_HISTORY_TURNS=12) already bound this well below
  // any tier ceiling in the common case, but a firm-authored skill body
  // (skill?.body, folded into `system` above) is attorney-controlled content
  // this code doesn't otherwise cap — guardChatBudget still checks the total
  // and trims history further (whole turns, oldest-first) if an oversized
  // skill body ever pushes a turn over budget. No page-capture in the portal
  // bot, so volatile is empty — nothing for step 2 to clip.
  const { maxTokens } = workRateParams('balanced', true)
  const guarded = guardChatBudget({
    systemStable: system,
    volatile: '',
    history,
    userMessage: message,
    model,
    // The portal bot always registers its client-portal tool set — same
    // reasoning as assistantChat.ts's applyTokenGuard: budget as though tools
    // are present, because they always are.
    maxTokens: maxTokens + 1024,
  })
  if (guarded.droppedHistoryTurns > 0) {
    console.warn(
      `[clientAssistantChat] token guard trimmed turn — droppedHistoryTurns=${guarded.droppedHistoryTurns} ` +
        `estimatedInputTokens=${guarded.estimatedInputTokens} model=${model}`,
    )
  }

  const messages: ChatMessage[] = [
    { role: 'system', content: guarded.systemStable },
    ...guarded.history,
    { role: 'user', content: guarded.userMessage },
  ]

  // Wrap prepare_request so the UI gets the consent card as a stream event too.
  const wrapped = tools.map((t) =>
    t.name === 'prepare_request'
      ? {
          ...t,
          run: async (i: unknown) => {
            const out = await t.run(i)
            try {
              requestCard = JSON.parse(out) as Record<string, unknown>
            } catch {
              requestCard = null
            }
            return out
          },
        }
      : t,
  )

  try {
    const stream = streamChatWithAssistant(ctx.tenantId, messages, {
      model,
      workRate: 'balanced',
      supportsWorkRate: true,
      webSearch: false, // client PII in context — never exfiltrate to search
      clientTools: wrapped,
    })
    for await (const chunk of stream as AsyncGenerator<AssistantStreamChunk>) {
      if (chunk.type === 'text') {
        reply += chunk.text
        yield { type: 'text', text: chunk.text }
      } else if (chunk.type === 'thinking') {
        yield { type: 'thinking', text: chunk.text }
      }
    }
  } catch {
    yield {
      type: 'error',
      text: 'I hit a problem answering that. Please try again, or message the firm directly from the Messages tab.',
    }
    return
  }

  if (requestCard) yield { type: 'request_card', card: requestCard }

  // The turn on the ledger — the CLIENT's own actor, contact-scoped. AI-CONTEXT
  // A4 — the portal had no stutter collapse (attorney turns got it via item 8);
  // same backstop here, on the persisted copy only — the live stream already
  // sent `reply`'s raw chunks to the client, so this only fixes what re-renders
  // from history.
  try {
    await recordAssistantTurn(ctx, {
      message,
      reply: collapseRoundStutter(reply),
      provider: 'anthropic',
      model,
      kind: 'question',
      citations: [],
      scope: 'contact',
      primaryEntityId: who.clientContactId,
    })
  } catch {
    // Recording must never break the reply the client already received.
  }

  yield { type: 'done' }
}
