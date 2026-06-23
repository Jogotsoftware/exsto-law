import { submitAction, type ActionContext } from '@exsto/substrate'

// CLIENT-PORTAL feedback capture. The portal's chat widget is, for now, a feedback
// channel: a signed-in client leaves feedback ABOUT the portal and it lands in the
// SAME triage surface as the attorney's beta feedback — an append-only
// `assistant.turn` event (kind='feedback') written through the action layer
// (event.record), so it shows up in `legal.assistant.feedback_*` / the backlog.
//
// It is deliberately client-scoped and contains NO model call and NO confidential
// matter context — pure capture. The submitter is tagged so triage can tell client
// portal feedback from attorney feedback (data.submitter='client',
// scope/surface='client_portal'), and clientContactId is recorded for attribution
// (the action's actor stays the public-intake system actor — ADR 0035).

const FEEDBACK_CATEGORIES = new Set(['ui', 'feature', 'workflow', 'other'])

export interface ClientFeedbackInput {
  // Stamped by the authed portal route from the session cookie.
  clientContactId: string
  message: string
  category?: string | null
  pageContext?: Record<string, unknown> | null
}

export async function submitClientPortalFeedback(
  ctx: ActionContext,
  input: ClientFeedbackInput,
): Promise<{ eventId: string }> {
  const message = (input.message ?? '').trim()
  if (!message) throw new Error('Type your feedback first.')
  if (message.length > 4000) throw new Error('That feedback is too long.')
  const category = FEEDBACK_CATEGORIES.has((input.category ?? '').trim())
    ? (input.category as string).trim()
    : 'other'

  const pageContext = {
    ...(input.pageContext ?? {}),
    surface: 'client_portal',
  }

  const res = await submitAction(ctx, {
    actionKindName: 'event.record',
    intentKind: 'reflection',
    payload: {
      event_kind_name: 'assistant.turn',
      primary_entity_id: null,
      source_type: 'human',
      source_ref: ctx.actorId,
      data: {
        message,
        reply: '',
        provider: 'none',
        model: '',
        kind: 'feedback',
        citations: [],
        scope: 'client_portal',
        category,
        page_context: pageContext,
        // Distinguish client-portal feedback from the attorney's own feedback.
        submitter: 'client',
        client_contact_id: input.clientContactId,
      },
    },
  })
  const eventId = (res.effects[0] as { eventId?: string } | undefined)?.eventId ?? res.actionId
  return { eventId }
}
