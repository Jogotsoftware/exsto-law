import { submitAction, withActionContext, type ActionContext } from '@exsto/substrate'

// FB-0 — message-level assistant feedback: a thumbs up/down on ONE specific
// assistant reply (attorney chat or the client-portal chat), with an optional
// note, plus the WHOLE visible chat at submit time saved for the team to
// review later. This is a DIFFERENT, narrower signal than the existing
// beta-feedback channel (assistant.turn kind='feedback' / legal.assistant.
// feedback_* — free-text product feedback about the app as a whole); keeping
// them as separate event kinds means neither triage surface has to filter the
// other out. See migration 0185 for the event_kind_definition row.
//
// Re-open-to-change is fine: the substrate is append-only, so changing your
// mind on a message submits a NEW event: the latest one wins for display, the
// earlier one stays on the ledger (never edited/deleted — invariant 14).

export type MessageFeedbackVerdict = 'up' | 'down'
export type MessageFeedbackSurface = 'attorney' | 'portal'

// One turn of the visible transcript, snapshotted at submit time. Deliberately
// minimal (role + the text actually shown) — this is a reviewer's read-back of
// the conversation, not a replay-exact log of every card/proposal that rode
// alongside it.
export interface TranscriptTurnSnapshot {
  role: 'user' | 'assistant'
  content: string
}

// Caps so a runaway/adversarial transcript can't blow up the content_blob or
// the note column. Ordinary chats are far smaller than any of these.
const MAX_NOTE_CHARS = 4000
const MAX_TURN_CHARS = 20_000
const MAX_TRANSCRIPT_TURNS = 200

export interface SubmitMessageFeedbackInput {
  verdict: MessageFeedbackVerdict
  note?: string | null
  surface: MessageFeedbackSurface
  // The assistant.turn event id this rates, when the caller has it (the
  // attorney surface always does; the portal stream does not yet return
  // per-turn event ids to the client).
  messageEventId?: string | null
  // 0-based position of the rated message within `transcript` — always known,
  // the durable "which message" reference even when messageEventId is absent.
  messageIndex: number
  matterEntityId?: string | null
  contactEntityId?: string | null
  chatSessionId?: string | null
  buildSessionId?: string | null
  // The WHOLE visible conversation (all turns), oldest-first.
  transcript: TranscriptTurnSnapshot[]
  // PORTAL ISOLATION: when set, this is a portal submission and clientContactId
  // — stamped by the authed portal route from the session cookie, NEVER
  // client-body-controlled — is the ONLY contact scope used. Any caller-
  // supplied contactEntityId/matterEntityId is ignored for a portal
  // submission, so a client can only ever rate their OWN chat, never another
  // client's or a matter's. See verticals/legal/src/mcp/tools/
  // clientPortalTools.ts and the route's identity-stamping (mirrors
  // clientAssistantChatStream's recordAssistantTurn call).
  clientContactId?: string | null
}

function clampNote(note: string | null | undefined): string | null {
  const trimmed = (note ?? '').trim()
  if (!trimmed) return null
  return trimmed.slice(0, MAX_NOTE_CHARS)
}

function clampTranscript(
  turns: TranscriptTurnSnapshot[] | undefined | null,
): TranscriptTurnSnapshot[] {
  return (turns ?? []).slice(-MAX_TRANSCRIPT_TURNS).map((t) => ({
    role: t.role === 'assistant' ? 'assistant' : 'user',
    content: (t.content ?? '').slice(0, MAX_TURN_CHARS),
  }))
}

export async function submitAssistantMessageFeedback(
  ctx: ActionContext,
  input: SubmitMessageFeedbackInput,
): Promise<{ eventId: string; transcriptBlobId: string }> {
  if (input.verdict !== 'up' && input.verdict !== 'down') {
    throw new Error('verdict must be "up" or "down".')
  }
  if (!Number.isInteger(input.messageIndex) || input.messageIndex < 0) {
    throw new Error('messageIndex must be a non-negative integer.')
  }
  const isPortal = input.surface === 'portal'
  if (isPortal && !input.clientContactId) {
    throw new Error('clientContactId is required for a portal feedback submission.')
  }

  const note = clampNote(input.note)
  // Portal isolation (belt-and-braces with the route-level stamp): a portal
  // submission is ALWAYS scoped to the caller's OWN client_contact and NEVER
  // to a matter — the portal assistant chat has no per-matter selection today.
  const contactEntityId = isPortal
    ? (input.clientContactId ?? null)
    : (input.contactEntityId ?? null)
  const matterEntityId = isPortal ? null : (input.matterEntityId ?? null)
  const primaryEntityId = matterEntityId ?? contactEntityId ?? null

  const turns = clampTranscript(input.transcript)

  // The transcript can rival a document in size — never inlined into the event
  // payload; a dedicated content_blob, same discipline as document.redlined's
  // ops_blob_id (migration 0183).
  const blobRes = await submitAction(ctx, {
    actionKindName: 'content_blob.store',
    intentKind: 'reflection',
    payload: {
      content_type: 'application/json',
      body: JSON.stringify({ turns }),
    },
  })
  const transcriptBlobId = (blobRes.effects[0] as { contentBlobId?: string } | undefined)
    ?.contentBlobId
  if (!transcriptBlobId) {
    throw new Error('Failed to store the feedback transcript.')
  }

  const eventRes = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'assistant.feedback_submitted',
      primary_entity_id: primaryEntityId,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        verdict: input.verdict,
        note,
        surface: input.surface,
        message_event_id: input.messageEventId ?? null,
        message_index: input.messageIndex,
        matter_entity_id: matterEntityId,
        contact_entity_id: contactEntityId,
        chat_session_id: input.chatSessionId ?? null,
        build_session_id: input.buildSessionId ?? null,
        full_transcript_blob_id: transcriptBlobId,
        transcript_turn_count: turns.length,
        client_contact_id: isPortal ? (input.clientContactId ?? null) : null,
      },
    },
  })
  const eventId =
    (eventRes.effects[0] as { eventId?: string } | undefined)?.eventId ?? eventRes.actionId
  return { eventId, transcriptBlobId }
}

export interface AssistantMessageFeedbackEntry {
  eventId: string
  verdict: MessageFeedbackVerdict
  note: string | null
  surface: MessageFeedbackSurface
  messageEventId: string | null
  messageIndex: number
  matterEntityId: string | null
  contactEntityId: string | null
  chatSessionId: string | null
  buildSessionId: string | null
  transcriptBlobId: string
  transcriptTurnCount: number
  recordedAt: string
}

// Attorney-only read (never exposed to the portal — see clientPolicy.ts). No UI
// browses this yet; it exists so the data is retrievable (support/triage query,
// a future dashboard) without reaching for raw SQL.
export async function listAssistantMessageFeedback(
  ctx: ActionContext,
): Promise<AssistantMessageFeedbackEntry[]> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      event_id: string
      payload: {
        verdict?: MessageFeedbackVerdict
        note?: string | null
        surface?: MessageFeedbackSurface
        message_event_id?: string | null
        message_index?: number
        matter_entity_id?: string | null
        contact_entity_id?: string | null
        chat_session_id?: string | null
        build_session_id?: string | null
        full_transcript_blob_id?: string
        transcript_turn_count?: number
      }
      occurred_at: string
    }>(
      `SELECT e.id AS event_id, e.payload,
              to_char(e.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSTZH:TZM') AS occurred_at
       FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1
         AND ekd.kind_name = 'assistant.feedback_submitted'
       ORDER BY e.occurred_at DESC
       LIMIT 500`,
      [ctx.tenantId],
    )
    return res.rows.map((r) => ({
      eventId: r.event_id,
      verdict: r.payload.verdict === 'down' ? 'down' : 'up',
      note: r.payload.note ?? null,
      surface: r.payload.surface === 'portal' ? 'portal' : 'attorney',
      messageEventId: r.payload.message_event_id ?? null,
      messageIndex: r.payload.message_index ?? 0,
      matterEntityId: r.payload.matter_entity_id ?? null,
      contactEntityId: r.payload.contact_entity_id ?? null,
      chatSessionId: r.payload.chat_session_id ?? null,
      buildSessionId: r.payload.build_session_id ?? null,
      transcriptBlobId: r.payload.full_transcript_blob_id ?? '',
      transcriptTurnCount: r.payload.transcript_turn_count ?? 0,
      recordedAt: r.occurred_at,
    }))
  })
}
