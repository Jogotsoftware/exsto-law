// Platform-admin payment-credential tools — provision exsto-law's own Stripe keys
// (stored encrypted in Vault). Reachable ONLY from /admin/api/mcp (default-deny via
// adminPolicy.ts); the operation core re-asserts platform-admin (assertPlatformAdmin)
// so the gate holds regardless of adapter. No secret is ever returned — status is
// booleans + the secret key's last four only.
import { registerTool, type Tool } from '@exsto/mcp-tools'
import type { ActionContext } from '@exsto/substrate'
import {
  getStripePlatformStatus,
  saveStripePlatformKeys,
  testStripePlatformConnection,
  clearStripePlatformKeys,
  type StripePlatformStatus,
  type SaveStripeKeysInput,
  type SaveStripeKeysResult,
} from '../../api/paymentsPlatform.js'

registerTool({
  name: 'admin.payments.status',
  description:
    'Which platform Stripe keys are set (secret / publishable / webhook), the secret key’s last four, and any last error. Platform admin only.',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ status: await getStripePlatformStatus(ctx) }),
} satisfies Tool<Record<string, never>, { status: StripePlatformStatus }>)

registerTool({
  name: 'admin.payments.set_keys',
  description:
    'Save the platform Stripe keys (encrypted in Vault). A blank field leaves the stored value unchanged; the secret key is verified against Stripe before saving. Platform admin only.',
  mode: 'write',
  inputSchema: {
    type: 'object',
    properties: {
      secretKey: { type: 'string', description: 'Stripe secret key (sk_test_… / sk_live_…).' },
      publishableKey: {
        type: 'string',
        description: 'Stripe publishable key (pk_test_… / pk_live_…).',
      },
      webhookSecret: { type: 'string', description: 'Webhook signing secret (whsec_…).' },
    },
    additionalProperties: false,
  },
  handler: async (ctx: ActionContext, input) => saveStripePlatformKeys(ctx, input),
} satisfies Tool<SaveStripeKeysInput, SaveStripeKeysResult>)

registerTool({
  name: 'admin.payments.test',
  description: 'Re-verify the stored Stripe secret key against Stripe. Platform admin only.',
  mode: 'read',
  handler: async (ctx: ActionContext) => testStripePlatformConnection(ctx),
} satisfies Tool<Record<string, never>, SaveStripeKeysResult>)

registerTool({
  name: 'admin.payments.clear',
  description:
    'Remove the stored platform Stripe keys (an environment-variable fallback, if any, still applies). Platform admin only.',
  mode: 'write',
  handler: async (ctx: ActionContext) => {
    await clearStripePlatformKeys(ctx)
    return { ok: true }
  },
} satisfies Tool<Record<string, never>, { ok: boolean }>)
