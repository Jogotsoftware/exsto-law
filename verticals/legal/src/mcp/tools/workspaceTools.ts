import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext, ActionResult } from '@exsto/substrate'
import {
  listWorkspaceEvents,
  createConsultation,
  rescheduleBooking,
  cancelBooking,
  listMailThreads,
  openMailThread,
  replyToThread,
  composeToClient,
  matterCommunications,
  type WorkspaceCalendarEvent,
  type MailThreadSummary,
  type MailThreadView,
  type MatterCommunication,
} from '../../index.js'

// ── Calendar tab (REQ-CALMAIL-01) ──────────────────────────────────────────

const listEventsTool: Tool<
  { fromIso: string; toIso: string },
  { events: WorkspaceCalendarEvent[]; source: 'google' | 'disconnected' }
> = {
  name: 'legal.calendar.events',
  description:
    "The attorney's real calendar for a window (live Google read), with matter linkage on consultation events.",
  mode: 'read',
  handler: (ctx: ActionContext, input) => listWorkspaceEvents(ctx, input.fromIso, input.toIso),
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

// ── Mail tab (REQ-CALMAIL-02/03) ───────────────────────────────────────────

const mailThreadsTool: Tool<
  Record<string, never>,
  { threads: MailThreadSummary[]; clientEmailCount: number }
> = {
  name: 'legal.mail.threads',
  description:
    'Client-related Gmail threads (queries are scoped to known matter-contact addresses only), matter-matched.',
  mode: 'read',
  handler: (ctx: ActionContext) => listMailThreads(ctx),
}

const mailThreadGetTool: Tool<{ gmailThreadId: string }, MailThreadView> = {
  name: 'legal.mail.thread_get',
  description:
    'Open a client thread: live Gmail read + idempotent mail.ingest projection onto the matched matter.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => openMailThread(ctx, input.gmailThreadId),
}

const mailReplyTool: Tool<{ gmailThreadId: string; bodyText: string }, ActionResult> = {
  name: 'legal.mail.reply',
  description:
    "Reply in-app through the attorney's real Gmail; recorded as mail.send with provenance integration:gmail.",
  mode: 'write',
  handler: (ctx: ActionContext, input) => replyToThread(ctx, input),
}

const mailComposeTool: Tool<{ to: string; subject: string; bodyText: string }, ActionResult> = {
  name: 'legal.mail.compose',
  description:
    'Compose to a known client contact (refuses non-client addresses); sends via Gmail and records mail.send.',
  mode: 'write',
  handler: (ctx: ActionContext, input) => composeToClient(ctx, input),
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
registerTool(createConsultationTool)
registerTool(rescheduleTool)
registerTool(cancelTool)
registerTool(mailThreadsTool)
registerTool(mailThreadGetTool)
registerTool(mailReplyTool)
registerTool(mailComposeTool)
registerTool(matterCommunicationsTool)
