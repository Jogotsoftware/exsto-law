import { registerTool, type Tool } from '@exsto/mcp-tools'
import {
  createReferralPartner,
  updateReferralPartner,
  createOtherAttorney,
  updateOtherAttorney,
  listReferralPartners,
  getReferralPartner,
  listOtherAttorneys,
  getOtherAttorney,
  type ReferralPartnerInput,
  type ReferralPartnerSummary,
  type ReferralPartnerDetail,
  type OtherAttorneyInput,
  type OtherAttorneySummary,
  type OtherAttorneyDetail,
} from '../../index.js'
import type { ActionContext, ActionResult } from '@exsto/substrate'

// ── Referral partners ────────────────────────────────────────────────────────

registerTool({
  name: 'legal.referralPartner.list',
  description: 'List all referral partners (outside professionals Pacheco refers matters out to).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ partners: await listReferralPartners(ctx) }),
} satisfies Tool<Record<string, never>, { partners: ReferralPartnerSummary[] }>)

registerTool({
  name: 'legal.referralPartner.get',
  description: 'Fetch a single referral partner by entity id.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    partner: await getReferralPartner(ctx, input.entityId),
  }),
} satisfies Tool<{ entityId: string }, { partner: ReferralPartnerDetail | null }>)

registerTool({
  name: 'legal.referralPartner.create',
  description: 'Create a referral partner contact record.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => createReferralPartner(ctx, input),
} satisfies Tool<ReferralPartnerInput, ActionResult>)

registerTool({
  name: 'legal.referralPartner.update',
  description:
    'Update a referral partner contact record (appends new attribute values; history is preserved).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => updateReferralPartner(ctx, input),
} satisfies Tool<ReferralPartnerInput, ActionResult>)

// ── Other attorneys ──────────────────────────────────────────────────────────

registerTool({
  name: 'legal.otherAttorney.list',
  description:
    'List all other attorneys in the network (co-counsel, opposing counsel, mentors, etc.).',
  mode: 'read',
  handler: async (ctx: ActionContext) => ({ attorneys: await listOtherAttorneys(ctx) }),
} satisfies Tool<Record<string, never>, { attorneys: OtherAttorneySummary[] }>)

registerTool({
  name: 'legal.otherAttorney.get',
  description: 'Fetch a single other-attorney record by entity id.',
  mode: 'read',
  handler: async (ctx: ActionContext, input) => ({
    attorney: await getOtherAttorney(ctx, input.entityId),
  }),
} satisfies Tool<{ entityId: string }, { attorney: OtherAttorneyDetail | null }>)

registerTool({
  name: 'legal.otherAttorney.create',
  description: 'Create an other-attorney contact record.',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => createOtherAttorney(ctx, input),
} satisfies Tool<OtherAttorneyInput, ActionResult>)

registerTool({
  name: 'legal.otherAttorney.update',
  description:
    'Update an other-attorney contact record (appends new attribute values; history is preserved).',
  mode: 'write',
  handler: async (ctx: ActionContext, input) => updateOtherAttorney(ctx, input),
} satisfies Tool<OtherAttorneyInput, ActionResult>)
