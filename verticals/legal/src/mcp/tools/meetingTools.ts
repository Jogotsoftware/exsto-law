import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  assignMeeting,
  unassignMeeting,
  reconcileAllMeetings,
  listMeetingsForMatter,
  listMeetingsForContact,
  listUnassignedMeetings,
  type AssignMeetingInput,
  type AssignMeetingResult,
  type MeetingSummary,
  type ReconcileSummary,
} from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

// Meetings (beta sprint Obj 8) — calendar events assigned to matters, surfaced on
// the matter and its contacts ALONGSIDE calls. The attorney picks a live Google
// event (from legal.calendar.events) and assigns it. Attorney-only (not in
// CLIENT_PORTAL_TOOLS; clientPolicy.ts is default-deny).

const assignTool: Tool<AssignMeetingInput, AssignMeetingResult> = {
  name: 'legal.meeting.assign',
  description:
    "Assign a Google Calendar event to a matter as a meeting. Pass the event's fields (from legal.calendar.events). Captures the event once (idempotent on its id), links it to the matter, and re-routes if it was on another matter. App-booked consultations are skipped (they already show as consultations).",
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      googleEventId: { type: 'string' },
      matterEntityId: { type: 'string' },
      summary: { type: 'string' },
      startedAt: { type: 'string', description: 'ISO start, or null.' },
      endedAt: { type: 'string', description: 'ISO end, or null.' },
      allDay: { type: 'boolean' },
      attendeeEmails: { type: 'array', items: { type: 'string' } },
      htmlLink: { type: 'string' },
      eventStatus: { type: 'string' },
    },
    required: [
      'googleEventId',
      'matterEntityId',
      'summary',
      'allDay',
      'attendeeEmails',
      'eventStatus',
    ],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => assignMeeting(ctx, input),
}

const unassignTool: Tool<{ calendarEventEntityId: string }, ActionResult> = {
  name: 'legal.meeting.unassign',
  description:
    'Detach a meeting from its matter (it leaves the matter/contact timelines; the captured record + history are preserved).',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: { calendarEventEntityId: { type: 'string' } },
    required: ['calendarEventEntityId'],
    additionalProperties: false,
  },
  handler: (ctx: ActionContext, input) => unassignMeeting(ctx, input.calendarEventEntityId),
}

const forMatterTool: Tool<{ matterEntityId: string }, { meetings: MeetingSummary[] }> = {
  name: 'legal.meeting.list_for_matter',
  description:
    "Meetings (calendar events) assigned to a matter, newest first, each with its title, time, attendees, and 'Open in Google' link. Renders alongside the matter's calls.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { matterEntityId: { type: 'string' } },
    required: ['matterEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    meetings: await listMeetingsForMatter(ctx, input.matterEntityId),
  }),
}

const forContactTool: Tool<{ contactEntityId: string }, { meetings: MeetingSummary[] }> = {
  name: 'legal.meeting.list_for_contact',
  description:
    "Meetings associated with a contact across every matter they're on, newest first. Renders alongside the contact's calls.",
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: { contactEntityId: { type: 'string' } },
    required: ['contactEntityId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    meetings: await listMeetingsForContact(ctx, input.contactEntityId),
  }),
}

const unassignedTool: Tool<Record<string, never>, { meetings: MeetingSummary[] }> = {
  name: 'legal.meeting.list_unassigned',
  description: 'Captured meetings not currently assigned to any matter (e.g. unassigned ones).',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ meetings: await listUnassignedMeetings(ctx) }),
}

// Drive the meeting↔Google two-way sync. The reconcile handler + reconcileAllMeetings
// already existed but nothing called them (legal.meeting.reconcile had fired 0×);
// this exposes them so a re-route/rename/cancel made in Google flows back as an
// append-only correction. Best-effort per event, safe to re-run, no input.
const reconcileTool: Tool<Record<string, never>, ReconcileSummary> = {
  name: 'legal.meeting.reconcile_all',
  description:
    'Reconcile every matter-assigned meeting against Google: re-reads each captured event and appends a legal.meeting.reconcile correction when it moved, was renamed, or was cancelled. Returns {checked, updated, cancelled, skipped}. Best-effort per event; safe to re-run.',
  mode: 'write',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: (ctx: ActionContext) => reconcileAllMeetings(ctx),
}

registerTool(assignTool)
registerTool(unassignTool)
registerTool(reconcileTool)
registerTool(forMatterTool)
registerTool(forContactTool)
registerTool(unassignedTool)
