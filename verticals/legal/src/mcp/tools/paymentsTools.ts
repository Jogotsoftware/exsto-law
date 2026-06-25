import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  getFirmPaymentStatus,
  refreshFirmPaymentStatus,
  disconnectFirmPayments,
  type FirmPaymentStatus,
} from '../../index.js'
import type { ActionContext } from '@exsto/substrate'

// Attorney-facing online-payment tools (Settings → Payments). Connecting itself
// is a browser redirect (the Express onboarding link), handled by the
// /api/billing/connect/init route — not an MCP tool, mirroring Google connect.
// These three are the status/refresh/disconnect surface the Settings card uses.

registerTool({
  name: 'legal.firm.payment_status',
  description:
    'The firm’s online-payment connection status (Stripe Connect): whether payments are configured, the connected account, and whether it can accept charges.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ status: await getFirmPaymentStatus(ctx) }),
} satisfies Tool<Record<string, never>, { status: FirmPaymentStatus }>)

registerTool({
  name: 'legal.firm.payment_refresh',
  description:
    'Re-check the firm’s Stripe account capabilities from Stripe and persist them (charges_enabled, details_submitted). Use after finishing onboarding.',
  mode: 'write',
  handler: async (ctx: ActionContext) => ({ status: await refreshFirmPaymentStatus(ctx) }),
} satisfies Tool<Record<string, never>, { status: FirmPaymentStatus }>)

registerTool({
  name: 'legal.firm.payment_disconnect',
  description:
    'Stop accepting online payments. Clears the firm’s local Stripe connection; the account persists at Stripe and can be reconnected.',
  mode: 'write',
  handler: async (ctx: ActionContext) => {
    await disconnectFirmPayments(ctx)
    return { ok: true }
  },
} satisfies Tool<Record<string, never>, { ok: boolean }>)
