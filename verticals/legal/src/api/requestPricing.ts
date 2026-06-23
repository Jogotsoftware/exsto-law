import { withActionContext, type ActionContext } from '@exsto/substrate'
import { readFirmDefaultRate } from '../handlers/firmSettings.js'

// Cost engine for client requests. A request's price is derived from the firm's
// HOURLY RATE (the same firm_default_hourly_rate the billing model uses) times a
// standard estimated effort per request type — so prices track the firm's rate and
// nothing is hardcoded in dollars. The client sees this quote and ACCEPTS it before
// the request is created; the accepted amount is then stored on the request and, on
// fulfilment, recorded as a matter fee.
//
// This is a starting point: per-type effort lives here as a clear default and can
// move to firm settings / per-service config later without changing callers.

export type RequestType = 'meeting' | 'document' | 'review'
export const REQUEST_TYPES: readonly RequestType[] = ['meeting', 'document', 'review']

export function isRequestType(v: unknown): v is RequestType {
  return typeof v === 'string' && (REQUEST_TYPES as readonly string[]).includes(v)
}

// Standard estimated effort (hours) for the fixed-effort request types.
const STANDARD_HOURS: Record<Exclude<RequestType, 'meeting'>, number> = {
  document: 1,
  review: 0.5,
}
const DEFAULT_MEETING_MINUTES = 60
const MIN_MEETING_MINUTES = 15
const MAX_MEETING_MINUTES = 8 * 60

const TYPE_LABEL: Record<RequestType, string> = {
  meeting: 'Meeting',
  document: 'Document',
  review: 'Attorney review',
}

export interface RequestQuote {
  requestType: RequestType
  /** Decimal string (ADR 0044). */
  amount: string
  currency: string
  /** Human explanation of how the price was derived. */
  basis: string
  /** For a meeting, the estimated length; null otherwise. */
  durationMinutes: number | null
  /** A default label for the request. */
  label: string
}

function round2(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2)
}

function rateLabel(rate: number): string {
  return `$${round2(rate)}/hr`
}

export interface QuoteInput {
  requestType: RequestType
  /** Meeting length in minutes (meeting only). */
  durationMinutes?: number | null
}

// Compute the quote for a request type. Throws a clear, client-safe error if the
// firm hasn't set an hourly rate yet (so the portal can tell the client to contact
// the firm rather than showing a $0 price).
export async function quoteClientRequest(
  ctx: ActionContext,
  input: QuoteInput,
): Promise<RequestQuote> {
  if (!isRequestType(input.requestType)) {
    throw new Error(`Unknown request type "${String(input.requestType)}".`)
  }
  return withActionContext(ctx, async (client) => {
    const rateStr = await readFirmDefaultRate(client, ctx.tenantId)
    const rate = rateStr ? Number(rateStr) : NaN
    if (!rateStr || !Number.isFinite(rate) || rate <= 0) {
      throw new Error('Pricing is not set up yet — please contact the firm for a quote.')
    }

    if (input.requestType === 'meeting') {
      let minutes = Math.round(input.durationMinutes ?? DEFAULT_MEETING_MINUTES)
      if (!Number.isFinite(minutes) || minutes <= 0) minutes = DEFAULT_MEETING_MINUTES
      // Clamp to [MIN, MAX] so a client-supplied duration can't drive the meeting
      // price arbitrarily low (e.g. durationMinutes:1) or absurdly high.
      minutes = Math.min(Math.max(minutes, MIN_MEETING_MINUTES), MAX_MEETING_MINUTES)
      const hours = minutes / 60
      return {
        requestType: 'meeting',
        amount: round2(rate * hours),
        currency: 'USD',
        basis: `${minutes} min @ ${rateLabel(rate)}`,
        durationMinutes: minutes,
        label: TYPE_LABEL.meeting,
      }
    }

    const hours = STANDARD_HOURS[input.requestType]
    return {
      requestType: input.requestType,
      amount: round2(rate * hours),
      currency: 'USD',
      basis: `est. ${hours.toFixed(1)} hr @ ${rateLabel(rate)}`,
      durationMinutes: null,
      label: TYPE_LABEL[input.requestType],
    }
  })
}
