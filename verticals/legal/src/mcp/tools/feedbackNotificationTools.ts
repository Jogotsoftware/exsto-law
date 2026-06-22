import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  resolveAssistantFeedback,
  listMyNotifications,
  markNotificationsSeen,
  type ResolveFeedbackInput,
  type NotificationItem,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// In-app notifications that close the beta-feedback loop (migration 0070).
// An admin/agent resolves a feedback item; the attorney who submitted it sees it
// in the nav bell with a link back to the page they were on.

registerTool({
  name: 'legal.assistant.feedback_resolve',
  description:
    'Mark a piece of beta feedback resolved and notify the attorney who submitted it, in-app, with a link back to the page they gave the feedback on. Pass the feedback event id (the ref shown on submit), a one-sentence plain-language summary of what the feedback/feature was (the notification headline — write this, do not echo codes or the raw text), and an optional note describing what was done. Records an append-only resolution event addressed to the submitter.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      feedbackEventId: {
        type: 'string',
        description: 'The assistant.turn (kind=feedback) event id — the ref shown when submitted.',
      },
      summary: {
        type: 'string',
        description:
          'A short, plain-language label for WHAT the feedback/feature was — a few words, not a sentence (e.g. "Invoice select-all", "Chat bubble tails"). Shown as "Resolved Feedback: <summary>" in the bell, truncated to ~35 chars, so keep it terse and code-free.',
      },
      note: {
        type: 'string',
        description: 'What was done about it (shown verbatim to the attorney).',
      },
    },
    required: ['feedbackEventId'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await resolveAssistantFeedback(ctx, input),
} satisfies Tool<ResolveFeedbackInput, { eventId: string }>)

registerTool({
  name: 'legal.notifications.list',
  description:
    "The current attorney's in-app notifications (resolved feedback addressed to them), newest first, each with a one-line summary of the feedback, the resolution note, an excerpt of the original (fallback), a link back to the page, and whether it is unread. Powers the nav notification bell.",
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => await listMyNotifications(ctx),
} satisfies Tool<Record<string, never>, { items: NotificationItem[]; unreadCount: number }>)

registerTool({
  name: 'legal.notifications.mark_seen',
  description:
    'Mark the current attorney’s notifications seen (records a notification.seen marker), clearing the unread badge. Called when the bell is opened.',
  mode: 'write',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => await markNotificationsSeen(ctx),
} satisfies Tool<Record<string, never>, { eventId: string }>)
