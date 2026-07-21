// ESIGN-UNIFY-1 (ES-1) — the ONE envelope-assembly builder (design §5.5).
//
// Two public send surfaces exist and keep their names (stable external
// contracts): `legal.esign.send_for_signature` (drafts, api/esign.ts
// sendForSignature) and `legal.esign.send_file` (uploads, api/esignFile.ts
// sendFileForSignature). Before ES-1 each assembled its own divergent
// esign.send payload; both now converge HERE. This module owns the payload
// shape — recipients WITH roles (§9.2), coordinate placements (§5.1), and the
// sender's personal message (§9.4) — and submits the single esign.send action.
// Delivery notification stays at the call sites (notifyDelivered in
// api/esign.ts), which also keeps this module import-cycle-free: it depends
// only on the operation core, never on api/esign.ts.

import { randomUUID } from 'node:crypto'
import { submitAction, type ActionContext } from '@exsto/substrate'
import type { EsignField } from '../esign/fields.js'
import type { FieldPlacement } from '../esign/placements.js'
import type { SignerRole } from '../esign/routing.js'

/** A recipient's role in the envelope (§9.2). Absent/legacy = needs_to_sign.
 *  One source of truth: esign/routing.ts (the pure dispatch planner). */
export type RecipientRole = SignerRole

// Re-exported here so `@exsto/legal` (whose barrel walks api/) exposes the
// placement types to the app — the composer imports them type-only.
export type { FieldPlacement, PlacementFieldType } from '../esign/placements.js'

export const RECIPIENT_ROLES: readonly RecipientRole[] = [
  'needs_to_sign',
  'needs_to_view',
  'receives_copy',
]

export function isRecipientRole(value: unknown): value is RecipientRole {
  return typeof value === 'string' && (RECIPIENT_ROLES as string[]).includes(value)
}

export interface EnvelopeRecipient {
  email: string
  name?: string | null
  /** Field key the document markers reference ({{type:key}}). */
  key?: string | null
  title?: string | null
  order?: number | null
  channel: 'portal' | 'link'
  role?: RecipientRole | null
}

export interface BuildEnvelopeInput {
  documentEntityId: string
  documentVersionId: string
  matterEntityId?: string | null
  provider: string
  providerEnvelopeRef?: string | null
  dispatched: boolean
  subject: string
  recipients: EnvelopeRecipient[]
  /** Legacy whole-line marker plan (0044) — drafts still parse and store it. */
  fields?: EsignField[]
  /** Resolved coordinate placements (§5.1) — the composer's plan. */
  placements?: FieldPlacement[]
  /** The sender's personal note (§9.4). */
  message?: string | null
  saveSignersAsContacts?: boolean
}

export interface BuildEnvelopeResult {
  envelopeId: string
  requestIds: string[]
  deliveredRequestIds: string[]
  status: string
  createdContacts: Array<{ email: string; contactEntityId: string }>
}

// Validate + submit ONE esign.send. Every recipient's role defaults to
// needs_to_sign (the pre-ES-1 behavior); an envelope whose recipients include
// a signing role but placements/fields for a key no recipient owns is the
// CALLER's validation concern (the draft path already enforces marker↔key
// matching; the composer enforces placement↔recipient matching in the UI).
export async function buildAndSubmitEnvelope(
  ctx: ActionContext,
  input: BuildEnvelopeInput,
): Promise<BuildEnvelopeResult> {
  const recipients = input.recipients.filter((r) => r.email?.trim())
  if (recipients.length === 0) {
    throw new Error('Add at least one recipient with an email address.')
  }
  // At least one recipient must actually sign — an envelope of only viewers/
  // copy recipients can never complete and would sit open forever (§9.2's
  // completion rule iterates needs_to_sign requests only).
  if (!recipients.some((r) => !r.role || r.role === 'needs_to_sign')) {
    throw new Error(
      'At least one recipient must have the "Needs to sign" role — an envelope with only viewers or copy recipients has nothing to complete.',
    )
  }
  for (const r of recipients) {
    if (r.role != null && !isRecipientRole(r.role)) {
      throw new Error(`Unknown recipient role: ${String(r.role)}`)
    }
  }

  const result = await submitAction(ctx, {
    actionKindName: 'esign.send',
    intentKind: 'enforcement',
    payload: {
      document_entity_id: input.documentEntityId,
      document_version_id: input.documentVersionId,
      matter_entity_id: input.matterEntityId ?? null,
      provider: input.provider,
      provider_envelope_ref: input.providerEnvelopeRef ?? null,
      dispatched: input.dispatched,
      correlation_id: randomUUID(),
      subject: input.subject,
      signers: recipients.map((r, i) => ({
        email: r.email.trim(),
        name: r.name ?? null,
        key: r.key ?? null,
        title: r.title ?? null,
        order: r.order ?? i + 1,
        channel: r.channel,
        role: r.role ?? 'needs_to_sign',
      })),
      fields: input.fields ?? [],
      placements: input.placements ?? [],
      message: input.message ?? null,
      save_signers_as_contacts: input.saveSignersAsContacts ?? true,
    },
  })

  const eff = (result.effects[0] ?? {}) as {
    envelopeId?: string
    requestIds?: string[]
    deliveredRequestIds?: string[]
    status?: string
    createdContacts?: Array<{ email: string; contactEntityId: string }>
  }
  return {
    envelopeId: eff.envelopeId ?? '',
    requestIds: eff.requestIds ?? [],
    deliveredRequestIds: eff.deliveredRequestIds ?? [],
    status: eff.status ?? (input.dispatched ? 'sent' : 'pending_dispatch'),
    createdContacts: eff.createdContacts ?? [],
  }
}
