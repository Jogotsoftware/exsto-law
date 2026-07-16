// "Something else" public intake (UI-BUILDER-FIX-1 Phase 3) — the tile on the
// public picker for a visitor whose need matches no live service. Captures free
// text + contact details as a client_request entity (kind from migration 0092,
// reused — request_type 'something_else') flagged for attorney triage. By
// explicit instruction: NO workflow starts, NO matter opens, NO routing/matching.
import { submitAction, type ActionContext } from '@exsto/substrate'

export interface SomethingElseInput {
  clientFullName: string
  clientEmail: string
  clientPhone?: string | null
  // The visitor's free-text description of what they need. Capped here to keep
  // an unauthenticated surface from storing unbounded text.
  requestText: string
}

const MAX_REQUEST_TEXT = 4000

export async function submitSomethingElseRequest(
  ctx: ActionContext,
  input: SomethingElseInput,
): Promise<{ requestId: string; clientContactId: string }> {
  const text = (input.requestText ?? '').trim().slice(0, MAX_REQUEST_TEXT)
  const res = await submitAction(ctx, {
    actionKindName: 'legal.client_request.create',
    intentKind: 'enforcement',
    payload: {
      request_type: 'something_else',
      description: text,
      client_full_name: input.clientFullName,
      client_email: input.clientEmail,
      client_phone: input.clientPhone ?? null,
    },
  })
  return res.effects[0] as { requestId: string; clientContactId: string }
}
