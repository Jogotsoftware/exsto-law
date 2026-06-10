import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  listRecentBookings,
  listUpcomingBookings,
  type RecentBooking,
  type UpcomingBooking,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

const upcomingTool: Tool<{ limit?: number }, { upcoming: UpcomingBooking[] }> = {
  name: 'legal.calendar.upcoming',
  description: 'List upcoming booked consultations (scheduled_at >= now).',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    upcoming: await listUpcomingBookings(ctx, input?.limit),
  }),
}

const recentTool: Tool<{ limit?: number }, { recent: RecentBooking[] }> = {
  name: 'legal.calendar.recent_bookings',
  description: 'List the most recent bookings, regardless of time.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    recent: await listRecentBookings(ctx, input?.limit),
  }),
}

registerTool(upcomingTool)
registerTool(recentTool)
