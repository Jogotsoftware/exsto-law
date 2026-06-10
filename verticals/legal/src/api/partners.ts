import { submitAction, type ActionContext, type ActionResult } from '@exsto/substrate'

export interface ReferralPartnerInput {
  entityId?: string
  fullName: string
  email?: string | null
  phone?: string | null
  firm?: string | null
  address?: string | null
  specialty?: string | null
  referralTerms?: string | null
  notes?: string | null
}

export interface OtherAttorneyInput {
  entityId?: string
  fullName: string
  email?: string | null
  phone?: string | null
  firm?: string | null
  barNumber?: string | null
  barState?: string | null
  role?: string | null
  notes?: string | null
}

function partnerPayload(input: ReferralPartnerInput) {
  return {
    entity_id: input.entityId,
    full_name: input.fullName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    firm: input.firm ?? null,
    address: input.address ?? null,
    specialty: input.specialty ?? null,
    referral_terms: input.referralTerms ?? null,
    notes: input.notes ?? null,
  }
}

function attorneyPayload(input: OtherAttorneyInput) {
  return {
    entity_id: input.entityId,
    full_name: input.fullName,
    email: input.email ?? null,
    phone: input.phone ?? null,
    firm: input.firm ?? null,
    bar_number: input.barNumber ?? null,
    bar_state: input.barState ?? null,
    role: input.role ?? null,
    notes: input.notes ?? null,
  }
}

export async function createReferralPartner(
  ctx: ActionContext,
  input: ReferralPartnerInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.referralPartner.create',
    intentKind: 'enforcement',
    payload: partnerPayload(input),
  })
}

export async function updateReferralPartner(
  ctx: ActionContext,
  input: ReferralPartnerInput,
): Promise<ActionResult> {
  if (!input.entityId) throw new Error('entityId is required to update a referral partner')
  return submitAction(ctx, {
    actionKindName: 'legal.referralPartner.update',
    intentKind: 'correction',
    payload: partnerPayload(input),
  })
}

export async function createOtherAttorney(
  ctx: ActionContext,
  input: OtherAttorneyInput,
): Promise<ActionResult> {
  return submitAction(ctx, {
    actionKindName: 'legal.otherAttorney.create',
    intentKind: 'enforcement',
    payload: attorneyPayload(input),
  })
}

export async function updateOtherAttorney(
  ctx: ActionContext,
  input: OtherAttorneyInput,
): Promise<ActionResult> {
  if (!input.entityId) throw new Error('entityId is required to update an other attorney')
  return submitAction(ctx, {
    actionKindName: 'legal.otherAttorney.update',
    intentKind: 'correction',
    payload: attorneyPayload(input),
  })
}
