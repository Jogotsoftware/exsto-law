import { submitAction, type ActionContext } from '@exsto/substrate'
import { quoteClientRequest, type RequestType, type RequestQuote } from './requestPricing.js'
import { getRequestRecord, type RequestStatus } from '../queries/clientRequests.js'
import { loadClientContactEmail, resolveClientMatterIds } from './clientIdentity.js'
import { queueNotification } from './notifications.js'

// Orchestration for client requests: the client CREATE/QUOTE half and the attorney
// lifecycle half (accept / start / fulfill / decline). Every state change goes
// through an action handler; fulfilment also records the accepted amount as a matter
// fee (legal.matter.add_fee) so it rolls into the next invoice. Status changes
// notify the other party.

const BASE_URL = (
  process.env.NEXT_PUBLIC_BASE_URL ??
  process.env.URL ??
  'https://exstolaw.netlify.app'
).replace(/\/$/, '')

const TYPE_LABEL: Record<RequestType, string> = {
  meeting: 'Meeting',
  document: 'Document',
  review: 'Attorney review',
}

// ── Client side ──────────────────────────────────────────────────────────────

export interface CreateRequestInput {
  clientContactId: string
  matterEntityId: string
  requestType: RequestType
  durationMinutes?: number | null
  description?: string | null
}

export interface CreatedRequest {
  requestId: string
  quote: RequestQuote
}

// Create a request the client has ACCEPTED. The price is recomputed server-side
// (never trusted from the browser) and stored as the accepted amount.
export async function createClientRequest(
  ctx: ActionContext,
  input: CreateRequestInput,
): Promise<CreatedRequest> {
  // Live authorization: re-resolve the client's CURRENT matters and reject a
  // request against one they no longer belong to. The authed route also checks
  // matterEntityId ∈ the session snapshot, but that snapshot is frozen for the 8h
  // session; this closes the window for a billable write (mirrors the reads).
  const liveMatterIds = await resolveClientMatterIds(ctx.tenantId, input.clientContactId)
  if (!liveMatterIds.includes(input.matterEntityId)) {
    throw new Error('You can only make a request on one of your own matters.')
  }

  const quote = await quoteClientRequest(ctx, {
    requestType: input.requestType,
    durationMinutes: input.durationMinutes ?? null,
  })

  const res = await submitAction(ctx, {
    actionKindName: 'legal.client_request.create',
    intentKind: 'exploration',
    payload: {
      matter_entity_id: input.matterEntityId,
      client_contact_id: input.clientContactId,
      request_type: input.requestType,
      description: input.description ?? null,
      price_amount: quote.amount,
      currency: quote.currency,
      price_basis: quote.basis,
      duration_minutes: quote.durationMinutes,
      accepted_at: new Date().toISOString(),
    },
  })
  const { requestId } = res.effects[0] as { requestId: string }

  // PORTAL-1 (WP5) — pre-draft what can be pre-drafted: an acknowledgement /
  // next-steps email lands in the ATTORNEY'S REVIEW QUEUE (never sent to the
  // client until the attorney approves — approve IS the send). Best-effort:
  // a drafting hiccup must not fail the request.
  try {
    const { enqueueAdHocCapabilityJob } = await import('./capabilityRuntime.js')
    await enqueueAdHocCapabilityJob(ctx, {
      capabilitySlug: 'email_generation',
      matterEntityId: input.matterEntityId,
      config: {
        mode: 'ai_draft',
        purpose:
          `The client filed a "${TYPE_LABEL[input.requestType]}" request from the portal` +
          (input.description ? `: "${input.description.slice(0, 500)}"` : '.') +
          ` Draft a short acknowledgement telling the client the firm received it and what happens next. Do not promise an outcome or a timeline.`,
        recipient_role: 'client',
      },
    })
  } catch {
    // The request stands on its own; the attorney still gets the notification.
  }

  // Tell the attorney a new request came in (recipient resolves to the firm).
  await queueNotification(ctx, {
    routeKindName: 'attorney_new_request',
    variables: {
      request_type: TYPE_LABEL[input.requestType],
      amount: quote.amount,
      currency: quote.currency,
      requests_url: `${BASE_URL}/attorney/requests`,
    },
  })

  return { requestId, quote }
}

// ── Attorney side ────────────────────────────────────────────────────────────

const STATUS_ACTION: Record<'accept' | 'start' | 'decline', string> = {
  accept: 'legal.client_request.accept',
  start: 'legal.client_request.start',
  decline: 'legal.client_request.decline',
}

async function notifyClientOfUpdate(
  ctx: ActionContext,
  requestId: string,
  status: RequestStatus,
): Promise<void> {
  const rec = await getRequestRecord(ctx, requestId)
  if (!rec?.clientContactId) return
  const email = await loadClientContactEmail(ctx.tenantId, rec.clientContactId)
  if (!email) return
  await queueNotification(ctx, {
    routeKindName: 'client_request_update',
    to: email,
    variables: {
      request_type: TYPE_LABEL[rec.requestType as RequestType] ?? rec.requestType,
      status,
      portal_url: `${BASE_URL}/portal`,
    },
  })
}

async function transition(
  ctx: ActionContext,
  requestId: string,
  which: 'accept' | 'start' | 'decline',
  status: RequestStatus,
): Promise<{ ok: boolean; status: RequestStatus }> {
  if (!requestId?.trim()) throw new Error('requestId is required.')
  await submitAction(ctx, {
    actionKindName: STATUS_ACTION[which],
    intentKind: 'enforcement',
    payload: { request_id: requestId },
  })
  await notifyClientOfUpdate(ctx, requestId, status)
  return { ok: true, status }
}

export async function acceptClientRequest(
  ctx: ActionContext,
  requestId: string,
): Promise<{ ok: boolean; status: RequestStatus }> {
  return transition(ctx, requestId, 'accept', 'accepted')
}
export async function startClientRequest(
  ctx: ActionContext,
  requestId: string,
): Promise<{ ok: boolean; status: RequestStatus }> {
  return transition(ctx, requestId, 'start', 'in_progress')
}
export async function declineClientRequest(
  ctx: ActionContext,
  requestId: string,
): Promise<{ ok: boolean; status: RequestStatus }> {
  return transition(ctx, requestId, 'decline', 'declined')
}

// Fulfil: the action handler atomically books the accepted amount as a matter
// service fee (so it rolls into the next invoice) AND moves the request to
// 'fulfilled' in ONE transaction — the status guard and the fee commit/roll back
// together, so a repeat fulfil can never double-bill or orphan a fee. Here we just
// invoke it and notify the client.
export async function fulfillClientRequest(
  ctx: ActionContext,
  requestId: string,
): Promise<{ ok: boolean; status: RequestStatus; billed: boolean }> {
  if (!requestId?.trim()) throw new Error('requestId is required.')
  const res = await submitAction(ctx, {
    actionKindName: 'legal.client_request.fulfill',
    intentKind: 'enforcement',
    payload: { request_id: requestId },
  })
  const eff = (res.effects[0] ?? {}) as { billed?: boolean }
  await notifyClientOfUpdate(ctx, requestId, 'fulfilled')
  return { ok: true, status: 'fulfilled', billed: eff.billed === true }
}
