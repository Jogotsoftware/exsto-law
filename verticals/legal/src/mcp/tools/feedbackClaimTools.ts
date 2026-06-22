import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  claimFeedback,
  releaseFeedback,
  listFeedbackBacklog,
  type ClaimFeedbackInput,
  type ReleaseFeedbackInput,
  type BacklogItem,
  type FeedbackStatus,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Beta-feedback "claimed / in-progress" coordination (migration 0089). With many
// parallel sessions, two would pick up the same feedback item. A session calls
// legal.assistant.feedback_backlog to see what is open vs already taken, then
// legal.assistant.feedback_claim BEFORE starting so others skip it (and
// legal.assistant.feedback_release if it abandons the work).

registerTool({
  name: 'legal.assistant.feedback_backlog',
  description:
    'The beta-feedback backlog with three-state status (open → in_progress → resolved) and, for in-progress items, who claimed it (a branch/session label). CALL THIS BEFORE picking up feedback work, to avoid duplicating something another session already owns. Optionally filter by status. Returns items newest-first plus a count per status.',
  mode: 'read',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['open', 'in_progress', 'resolved'],
        description: 'Filter to one status (omit for all).',
      },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await listFeedbackBacklog(ctx, input ?? {}),
} satisfies Tool<
  { status?: FeedbackStatus },
  { items: BacklogItem[]; counts: Record<FeedbackStatus, number> }
>)

registerTool({
  name: 'legal.assistant.feedback_claim',
  description:
    'Claim a beta-feedback item (mark it in-progress) so parallel sessions do not duplicate it. Pass the feedback event id and a claimedBy label identifying you (your branch/session/PR, e.g. "feat/calendar-grid"). Records an append-only claim; the latest claim wins. Resolve it (legal.assistant.feedback_resolve) when shipped, or release it if you abandon it.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      feedbackEventId: {
        type: 'string',
        description: 'The assistant.turn (kind=feedback) event id.',
      },
      claimedBy: {
        type: 'string',
        description: 'A branch/session/PR label identifying who is taking it.',
      },
      note: { type: 'string', description: 'Optional note on what you intend to do.' },
    },
    required: ['feedbackEventId', 'claimedBy'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await claimFeedback(ctx, input),
} satisfies Tool<ClaimFeedbackInput, { eventId: string }>)

registerTool({
  name: 'legal.assistant.feedback_release',
  description:
    'Release a claim on a beta-feedback item (return it to the open pool) when you abandon or hand off the work. Pass the feedback event id and a releasedBy label.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      feedbackEventId: {
        type: 'string',
        description: 'The assistant.turn (kind=feedback) event id.',
      },
      releasedBy: { type: 'string', description: 'A branch/session/PR label identifying you.' },
      note: { type: 'string', description: 'Optional reason.' },
    },
    required: ['feedbackEventId', 'releasedBy'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => await releaseFeedback(ctx, input),
} satisfies Tool<ReleaseFeedbackInput, { eventId: string }>)
