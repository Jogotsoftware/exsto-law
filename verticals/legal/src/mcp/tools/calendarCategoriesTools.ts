import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getCalendarCategories,
  updateCalendarCategories,
  categorizeBooking,
  type CalendarCategory,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Read the firm's calendar category palette (color-coding call types).
registerTool({
  name: 'legal.calendar.categories.get',
  description: 'Get the firm’s configurable calendar category palette ({key,label,color}[]).',
  mode: 'read',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  handler: async (ctx: ActionContext) => ({ categories: await getCalendarCategories(ctx) }),
} satisfies Tool<Record<string, never>, { categories: CalendarCategory[] }>)

// Set the firm's calendar category palette (versioned + audited).
registerTool({
  name: 'legal.calendar.categories.set',
  description:
    'Set (replace) the firm’s calendar category palette. Pass categories: [{key,label,color}]. Supersedes the prior version; audited.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      categories: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            label: { type: 'string' },
            color: { type: 'string', description: 'Hex color, e.g. #2563eb' },
          },
          required: ['key', 'label', 'color'],
          additionalProperties: false,
        },
      },
    },
    required: ['categories'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => ({
    categories: await updateCalendarCategories(
      ctx,
      (input as { categories: CalendarCategory[] }).categories,
    ),
  }),
} satisfies Tool<{ categories: CalendarCategory[] }, { categories: CalendarCategory[] }>)

// Set/clear the call-type category on a matter's consultation.
registerTool({
  name: 'legal.booking.categorize',
  description:
    'Set the call-type category on a matter’s consultation (a palette key). An empty key clears it.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      matterEntityId: { type: 'string' },
      categoryKey: {
        type: 'string',
        description: 'A firm.calendar_categories palette key, or "" to clear.',
      },
    },
    required: ['matterEntityId', 'categoryKey'],
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => {
    const i = input as { matterEntityId: string; categoryKey: string }
    return categorizeBooking(ctx, { matterEntityId: i.matterEntityId, categoryKey: i.categoryKey })
  },
} satisfies Tool<
  { matterEntityId: string; categoryKey: string },
  { matterEntityId: string; categoryKey: string }
>)
