import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext, ActionResult } from '@exsto/substrate'
import {
  listWorkspaceEvents,
  listCalendarFeed,
  type CalendarFeedItem,
  getBusyIntervals,
  type BusyIntervalsResult,
  createConsultation,
  rescheduleBooking,
  cancelBooking,
  addBookingAttendees,
  listMailThreads,
  openMailThread,
  replyToThread,
  composeToClient,
  matterCommunications,
  recipientMatters,
  attachableDocuments,
  type WorkspaceCalendarEvent,
  type CalendarSource,
  type MailThreadSummary,
  type MailThreadView,
  type MatterCommunication,
  type AttachableDocuments,
} from '../../index.js'

// ── Calendar tab (REQ-CALMAIL-01) ──────────────────────────────────────────

const listEventsTool: Tool<
  { fromIso: string; toIso: string },
  { events: WorkspaceCalendarEvent[]; source: CalendarSource; error?: string }
> = {
  name: 'legal.calendar.events',
  description:
    "The attorney's real calendar for a window (live Google read), with matter linkage on consultation events.",
  mode: 'read',
  handler: (ctx: ActionContext, input) => listWorkspaceEvents(ctx, input.fromIso, input.toIso),
}

// The dashboard calendar feed: real Google events + app consultations, merged and
// deduped, for [fromIso, toIso). This is what makes the dashboard show the
// attorney's actual live calendar (not just app-booked consultations).
const calendarFeedTool: Tool<
  { fromIso: string; toIso: string },
  { items: CalendarFeedItem[]; source: CalendarSource; error?: string }
> = {
  name: 'legal.calendar.feed',
  description:
    "The attorney's calendar for a window: real live Google events merged with app-booked consultations (deduped). Consultations carry matter context; the attorney's other Google events ride along as read-only. source='disconnected' = Google not connected; source='error' = connected but the live read failed (the cause is in `error`, e.g. the Calendar API is disabled in the Cloud project); both return consultations only.",
  mode: 'read',
  handler: (ctx: ActionContext, input) => listCalendarFeed(ctx, input.fromIso, input.toIso),
}

// Contract M: busy intervals on the attorney's synced Google calendar. S5's
// availability engine consumes this; free time is the complement within the
// queried window. source='disconnected' = Google not connected; source='error'
// = connected but the read failed (cause in `error`).
const busyIntervalsTool: Tool<{ fromIso: string; toIso: string }, BusyIntervalsResult> = {
  name: 'legal.calendar.busy',
  description:
    "Busy intervals on the attorney's synced Google calendar for [fromIso, toIso) (Contract M). Free time is the complement within the window. source='disconnected' = Google not connected; source='error' = connected but the read failed (cause in `error`).",
  mode: 'read',
  handler: (ctx: ActionContext, input) =>
    getBusyIntervals(ctx, { fromIso: input.fromIso, toIso: input.toIso }),
}

const createConsultationTool: Tool<
  { matterEntityId: string; startIso: string; endIso: string },
  ActionResult
> = {
  name: 'legal.booking.create_for_matter',
  description:
    'Attorney-side: book a consultation for a matter from the Calendar tab. Creates the Google event (invites) and records booking.create.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => createConsultation(ctx, input),
}

const rescheduleTool: Tool<
  { matterEntityId: string; startIso: string; endIso: string },
  ActionResult
> = {
  name: 'legal.booking.reschedule',
  description:
    'Reschedule a consultation: patches the Google event (sendUpdates all) and records booking.update.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => rescheduleBooking(ctx, input),
}

const cancelTool: Tool<{ matterEntityId: string; reason?: string }, ActionResult> = {
  name: 'legal.booking.cancel',
  description:
    'Cancel a consultation: deletes the Google event (sendUpdates all) and records booking.cancel.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => cancelBooking(ctx, input),
}

const addAttendeesTool: Tool<
  { matterEntityId: string; attendeeEmails: string[] },
  { attendees: string[] }
> = {
  name: 'legal.booking.add_attendees',
  description:
    "Invite extra guests to a matter's consultation: merges the emails into the Google event's attendees and sends them an invite (sendUpdates all). Returns the full attendee list.",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      attendeeEmails: { type: 'array', items: { type: 'string' } },
    },
    required: ['matterEntityId', 'attendeeEmails'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => addBookingAttendees(ctx, input),
}

// ── Mail tab (REQ-CALMAIL-02/03) ───────────────────────────────────────────

const mailThreadsTool: Tool<
  { query?: string },
  { threads: MailThreadSummary[]; clientEmailCount: number }
> = {
  name: 'legal.mail.threads',
  description:
    'Client-related Gmail threads (queries are scoped to known matter-contact addresses only), matter-matched. An optional `query` is ANDed onto that scope as a Gmail search (e.g. "invoice", "subject:engagement", "after:2026/01/01"), so it filters within client mail without escaping it.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional Gmail search terms, applied within the client-mail scope.',
      },
    },
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => listMailThreads(ctx, input.query),
}

const mailThreadGetTool: Tool<{ gmailThreadId: string }, MailThreadView> = {
  name: 'legal.mail.thread_get',
  description:
    'Open a client thread: live Gmail read + idempotent mail.ingest projection onto the matched matter.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => openMailThread(ctx, input.gmailThreadId),
}

const mailReplyTool: Tool<
  { gmailThreadId: string; bodyText: string; bodyHtml?: string },
  ActionResult
> = {
  name: 'legal.mail.reply',
  description:
    "Reply in-app through the attorney's real Gmail; recorded as mail.send with provenance integration:gmail. bodyText is the plaintext (and recorded) body; an optional bodyHtml carries rich-text formatting (bold, lists) as the HTML alternative.",
  mode: 'write',
  handler: (ctx: ActionContext, input) => replyToThread(ctx, input),
}

const mailComposeTool: Tool<
  { to: string; subject: string; bodyText: string; bodyHtml?: string },
  ActionResult
> = {
  name: 'legal.mail.compose',
  description:
    'Compose to a known client contact (refuses non-client addresses); sends via Gmail and records mail.send. bodyText is the plaintext body; an optional bodyHtml carries rich-text formatting (bold, lists) as the HTML alternative.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => composeToClient(ctx, input),
}

// Mail attachment picker (reads): which matters a recipient is a client of (compose),
// and the documents attachable for a matter (uploads + latest draft per document).
const recipientMattersTool: Tool<
  { email: string },
  { matters: Array<{ matterEntityId: string; matterNumber: string }> }
> = {
  name: 'legal.mail.recipient_matters',
  description:
    'The matters a recipient email address is a client of — used to scope which documents may be attached when composing to that client. Empty if not a known client contact.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { email: { type: 'string' } },
    required: ['email'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    matters: await recipientMatters(ctx, input.email),
  }),
}

const attachableDocumentsTool: Tool<{ matterEntityId: string }, AttachableDocuments> = {
  name: 'legal.mail.attachable_documents',
  description:
    "A matter's documents available to attach to client email: uploaded files and the latest version of each generated draft. Metadata only; the chosen document_version ids are resolved to bytes server-side at send time.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => attachableDocuments(ctx, input.matterEntityId),
}

const matterCommunicationsTool: Tool<
  { matterEntityId: string },
  { threads: MatterCommunication[] }
> = {
  name: 'legal.matter.communications',
  description:
    'Matter-scoped communication history from the substrate (ingested threads + previews).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    threads: await matterCommunications(ctx, input.matterEntityId),
  }),
}

registerTool(listEventsTool)
registerTool(calendarFeedTool)
registerTool(busyIntervalsTool)
registerTool(createConsultationTool)
registerTool(rescheduleTool)
registerTool(cancelTool)
registerTool(addAttendeesTool)
registerTool(mailThreadsTool)
registerTool(mailThreadGetTool)
registerTool(mailReplyTool)
registerTool(mailComposeTool)
registerTool(recipientMattersTool)
registerTool(attachableDocumentsTool)
registerTool(matterCommunicationsTool)
