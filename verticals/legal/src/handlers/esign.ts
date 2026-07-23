// E-signature action handlers (Session 5). All writes flow through these
// handlers under submitAction (vertical CLAUDE.md). Provider-agnostic: nothing
// here names a provider — it is an attribute value. Native sign-by-link with
// DocuSign-style fields, per-signer titles, sequential routing, and delivered/
// opened/signed status.
//
//   esign.send     → create signature_envelope (+ one signature_request per
//                    signer: key/title/order/channel), store the field plan,
//                    dispatch the first routing group. esign.sent ONLY — no
//                    optimistic esign.delivered (ES-5b): the first group's status
//                    is dispatched ("Sent"), never a claimed inbox delivery.
//   esign.open     → a signer opened their document (dispatched → opened). esign.opened.
//   esign.sign     → a signer adopts their signature + fills their fields. When
//                    the current routing group finishes, the next group is
//                    delivered (esign.delivered); when ALL sign, the envelope
//                    completes and the executed copy — every field tag resolved
//                    + a signature certificate with the original content SHA-256 —
//                    is written as a NEW immutable document_version (invariant 14).
//   esign.decline  → a signer declines; the envelope closes. esign.declined.
//   esign.record_status → EXTERNAL (dormant): same transitions for a future driver.
//   esign.add_signer → ADD-NEXT-SIGNER-1: insert a NEW signature_request mid-
//                    envelope (a signer whose role opted in, or the attorney's
//                    own "add signer"), ordered right after an anchor request
//                    and ahead of anything already queued later. Delivered
//                    immediately if nothing else is unresolved ahead of it.
//   esign.finish_signing → ADD-NEXT-SIGNER-1: the deferred completion tail
//                    (shared with esign.sign's normal path via
//                    completeEnvelope) — runs when a signer explicitly
//                    confirms "no more signers" after their signature held
//                    the envelope open awaiting that decision.
import { createHash } from 'node:crypto'
import { registerActionHandler, type ActionContext } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  insertAttribute,
  insertContentBlob,
  insertDocumentVersion,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'
import {
  isSignatureImageDataUrl,
  renderImageSignature,
  renderTypedSignature,
  resolveExecutedMarkdown,
  type EsignField,
} from '../esign/fields.js'
import { buildFileCertificateMarkdown } from '../esign/fileCertificate.js'
import type { FieldPlacement } from '../esign/placements.js'
// ESIGN-UNIFY-1 (ES-1, design §9.2): role-aware dispatch/completion decisions
// are PURE functions (esign/routing.ts) so the sign/view/copy × order matrix is
// unit-testable without a DB; this handler only executes the plan (attribute
// writes + events).
import {
  copyRecipients,
  nextInsertionOrder,
  normalizeRole,
  planInitialDispatch,
  planNextDelivery,
  shouldHoldForAddDecision,
  type SignerRole,
} from '../esign/routing.js'
import { dispatchLifecycleEvent } from '../lifecycle/executor.js'
import { findContactByEmail } from './intake.js'

interface SendSigner {
  email: string
  name?: string | null
  key?: string | null
  title?: string | null
  order?: number | null
  channel?: 'portal' | 'link' | null
  signer_provider_ref?: string | null
  /** ESIGN-UNIFY-1 (ES-1): defaults to 'needs_to_sign' when absent — every
   *  caller written before this migration keeps its exact prior behavior. */
  role?: SignerRole | null
  /** PRESIGN-1 — this signer's request is completed at SEND with the attorney's
   *  standing signature (resolved server-side by the send builder). Its request
   *  starts 'signed', is never delivered, and the client becomes the first turn.
   *  presigned_signature_data is a PNG/JPEG data URL (drawn/uploaded) or absent
   *  (typed → the printed name is the signature). */
  presigned?: boolean | null
  presigned_signature_data?: string | null
  presigned_signature_name?: string | null
  /** ADD-NEXT-SIGNER-1 — this signer may add the next signer instead of
   *  auto-completing the envelope, if their signature would otherwise be the
   *  one that finishes it. Written as `signer_allow_add_next` (mirrors
   *  signer_role) so esign.sign can read it back for the completing request. */
  allow_add_next?: boolean | null
}

/** One document in an envelope's ordered set (ES-MULTIDOC-1). */
interface EsignSendDocument {
  document_entity_id: string
  document_version_id: string
}

interface EsignSendPayload {
  document_entity_id: string
  document_version_id: string
  /** ES-MULTIDOC-1: the FULL ordered document set when the envelope carries more
   *  than one document. documents[0] equals (document_entity_id,
   *  document_version_id) — the primary the envelope entity + single-doc readers
   *  key on. Absent/empty ⇒ the single primary IS the set (pre-multidoc shape,
   *  every existing caller unchanged). */
  documents?: EsignSendDocument[]
  matter_entity_id?: string | null
  provider: string
  provider_envelope_ref?: string | null
  dispatched: boolean
  correlation_id: string
  subject: string
  signers: SendSigner[]
  /** The parsed field plan for the document (anchor tags) — the legacy
   *  whole-line marker model (0044). */
  fields?: EsignField[]
  /** ESIGN-UNIFY-1 (ES-1, §5.1): the resolved coordinate placement plan —
   *  supersedes `fields` for envelopes sent by the unified composer. */
  placements?: FieldPlacement[]
  /** ESIGN-UNIFY-1 (ES-1, §9.4): the sender's personal note, shown in the
   *  branded signing email. */
  message?: string | null
  /** 0170: create a client_contact for any signer email not already in contacts
   *  (same dedupe-by-email rule as intake.submit) — "people you send to become
   *  contacts", DocuSign-style. */
  save_signers_as_contacts?: boolean
}

registerActionHandler('esign.send', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignSendPayload
  const tenantId = ctx.tenantId

  // 0170: every NEW recipient becomes a contact (existing emails dedupe via the
  // same case-insensitive rule intake.submit uses). Runs first, inside this
  // action's transaction, so a failed send never leaves an envelope without its
  // contacts or vice versa mid-request.
  const createdContacts: Array<{ email: string; contactEntityId: string }> = []
  if (p.save_signers_as_contacts) {
    const contactKindId = await lookupKindId(
      client,
      'entity_kind_definition',
      tenantId,
      'client_contact',
    )
    const seen = new Map<string, string>()
    for (const s of p.signers) {
      const email = s.email?.trim()
      if (!email || seen.has(email.toLowerCase())) continue
      const existing = await findContactByEmail(client, tenantId, email)
      if (existing) {
        seen.set(email.toLowerCase(), existing)
        continue
      }
      const contactEntityId = await insertEntity(
        client,
        tenantId,
        actionId,
        contactKindId,
        s.name?.trim() || email,
      )
      const attrs: Array<{ kind: string; value: unknown }> = [{ kind: 'email', value: email }]
      if (s.name?.trim()) attrs.push({ kind: 'full_name', value: s.name.trim() })
      for (const a of attrs) {
        const akId = await lookupKindId(client, 'attribute_kind_definition', tenantId, a.kind)
        await insertAttribute(client, {
          tenantId,
          actionId,
          entityId: contactEntityId,
          attributeKindId: akId,
          value: a.value,
          confidence: 1.0,
          sourceType: 'human',
          sourceRef: ctx.actorId,
        })
      }
      seen.set(email.toLowerCase(), contactEntityId)
      createdContacts.push({ email, contactEntityId })
    }
  }

  const envelopeKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    'signature_envelope',
  )
  const envelopeId = await insertEntity(client, tenantId, actionId, envelopeKindId, p.subject, {
    provider: p.provider,
    document_version_id: p.document_version_id,
    correlation_id: p.correlation_id,
    dispatched: p.dispatched,
  })

  const envelopeStatus = p.dispatched ? 'sent' : 'pending_dispatch'
  await setAttr(client, tenantId, actionId, envelopeId, 'envelope_status', envelopeStatus, {
    sourceRef: ctx.actorId,
  })
  await setAttr(client, tenantId, actionId, envelopeId, 'esign_provider', p.provider, {
    sourceRef: ctx.actorId,
  })
  await setAttr(client, tenantId, actionId, envelopeId, 'envelope_subject', p.subject, {
    sourceRef: ctx.actorId,
  })
  await setAttr(client, tenantId, actionId, envelopeId, 'envelope_fields', p.fields ?? [], {
    sourceRef: ctx.actorId,
  })
  // ESIGN-UNIFY-1 (ES-1, §5.1) — the placement plan always writes (defaults to
  // an empty array); legacy readers ignore it and keep using `envelope_fields`.
  await setAttr(client, tenantId, actionId, envelopeId, 'envelope_placements', p.placements ?? [], {
    sourceRef: ctx.actorId,
  })
  // §9.4 — the sender's personal note. Only written when non-empty: an omitted
  // message should read as "no message" (unset), not an empty-string history
  // entry on every send.
  if (p.message?.trim()) {
    await setAttr(client, tenantId, actionId, envelopeId, 'envelope_message', p.message.trim(), {
      sourceRef: ctx.actorId,
    })
  }
  if (p.dispatched && p.provider_envelope_ref) {
    await setAttr(
      client,
      tenantId,
      actionId,
      envelopeId,
      'provider_envelope_ref',
      p.provider_envelope_ref,
      { sourceType: 'integration', sourceRef: `integration:${p.provider}` },
    )
  }

  // ES-MULTIDOC-1 — link every document in the envelope's ordered set. NO new
  // relationship kind and NO migration: the existing `envelope_of` relationship
  // (one per document) plus an `order` in its properties carries the whole set.
  // A single-document envelope writes exactly one relationship with order 0 —
  // byte-identical to the pre-multidoc write except for the additive `order`
  // key, which every existing reader ignores.
  const envelopeDocs: EsignSendDocument[] =
    p.documents && p.documents.length > 0
      ? p.documents
      : [{ document_entity_id: p.document_entity_id, document_version_id: p.document_version_id }]
  const envelopeOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    tenantId,
    'envelope_of',
  )
  for (let d = 0; d < envelopeDocs.length; d++) {
    const doc = envelopeDocs[d]!
    await insertRelationship(client, {
      tenantId,
      actionId,
      sourceEntityId: envelopeId,
      targetEntityId: doc.document_entity_id,
      relationshipKindId: envelopeOfId,
      properties: { document_version_id: doc.document_version_id, order: d },
    })
  }

  const requestOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    tenantId,
    'request_of',
  )
  const requestKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    'signature_request',
  )
  const requestIds: string[] = []
  // ESIGN-UNIFY-1 (ES-1, §9.2) — role-aware dispatch plan, computed up front by
  // the pure planner: needs_to_sign follows the existing lowest-order routing
  // (sequential delivers group 1; pure-parallel envelopes share one order);
  // needs_to_view is delivered WITH the first group regardless of its own
  // order (viewers gate nothing); receives_copy is never delivered at send
  // (notified only once the envelope completes).
  const initialStatuses = planInitialDispatch(p.signers)
  const deliveredAtSend: string[] = []
  for (let i = 0; i < p.signers.length; i++) {
    const s = p.signers[i]!
    const requestId = await insertEntity(
      client,
      tenantId,
      actionId,
      requestKindId,
      s.name ?? s.email,
      { email: s.email },
    )
    await setAttr(client, tenantId, actionId, requestId, 'signer_email', s.email, {
      sourceRef: ctx.actorId,
    })
    if (s.name)
      await setAttr(client, tenantId, actionId, requestId, 'signer_name', s.name, {
        sourceRef: ctx.actorId,
      })
    if (s.key)
      await setAttr(client, tenantId, actionId, requestId, 'signer_key', s.key, {
        sourceRef: ctx.actorId,
      })
    if (s.title)
      await setAttr(client, tenantId, actionId, requestId, 'signer_title', s.title, {
        sourceRef: ctx.actorId,
      })
    await setAttr(client, tenantId, actionId, requestId, 'signer_order', s.order ?? i + 1, {
      sourceRef: ctx.actorId,
    })
    await setAttr(client, tenantId, actionId, requestId, 'signer_channel', s.channel ?? 'link', {
      sourceRef: ctx.actorId,
    })
    // ESIGN-UNIFY-1 (ES-1, §9.2) — always written (explicit), so every NEW
    // envelope carries its role; reads of pre-migration rows default via
    // `normalizeRole` at the call sites, never here.
    const role: SignerRole = normalizeRole(s.role)
    await setAttr(client, tenantId, actionId, requestId, 'signer_role', role, {
      sourceRef: ctx.actorId,
    })
    // ADD-NEXT-SIGNER-1 — only written when true (mirrors signer_key/
    // signer_title's "optional, absent reads as the safe default" style,
    // rather than signer_role's "always written" style — most requests never
    // set this).
    if (s.allow_add_next) {
      await setAttr(client, tenantId, actionId, requestId, 'signer_allow_add_next', true, {
        sourceRef: ctx.actorId,
      })
    }
    // BUILDER-CERT-1 (WP4) — write each signer's INITIAL status exactly once.
    // The first routing group starts 'delivered' directly; later groups start
    // 'pending' (deliverNextGroup promotes them on later sign actions). The old
    // shape (write 'pending', then deliverNextGroup overwrites 'delivered' in the
    // SAME transaction) produced two open attribute rows with an identical
    // valid_from — an UNDEFINED current state that the first workflow-driven
    // e-sign run hit for real: latestAttr read back 'pending' and
    // assertSignerTurn blocked the envelope's only signer forever.
    // Role-aware statuses come from planInitialDispatch (index-aligned).
    const initialStatus = initialStatuses[i] ?? 'pending'
    await setAttr(client, tenantId, actionId, requestId, 'signer_status', initialStatus, {
      sourceRef: ctx.actorId,
    })
    if (initialStatus === 'delivered') deliveredAtSend.push(requestId)
    // PRESIGN-1 — a pre-signed attorney signer is COMPLETED at send with their
    // standing signature (resolved server-side by the send builder, never the
    // caller). Same request writes an interactive esign.sign would make, minus a
    // delivery/turn: the signature, a timestamp, a system consent line, and the
    // esign.signed event the routing + executed-copy machinery reads. planNext-
    // Delivery already treats status==='signed' as resolved, so the client (next
    // order) is the first real turn and the envelope completes when they sign.
    if (initialStatus === 'signed' && s.presigned) {
      const presignedAt = new Date().toISOString()
      const sourceRefReq = `signature_request:${requestId}`
      await setAttr(client, tenantId, actionId, requestId, 'signed_at', presignedAt, {
        sourceRef: sourceRefReq,
      })
      await setAttr(
        client,
        tenantId,
        actionId,
        requestId,
        'signer_consent',
        'Applied automatically from the attorney’s saved signature (pre-signed).',
        { sourceRef: sourceRefReq },
      )
      await setAttr(
        client,
        tenantId,
        actionId,
        requestId,
        'signature_data',
        s.presigned_signature_data ?? s.presigned_signature_name ?? s.name ?? s.email,
        { sourceRef: sourceRefReq },
      )
      await insertEvent(client, {
        tenantId,
        actionId,
        eventKindName: 'esign.signed',
        primaryEntityId: envelopeId,
        secondaryEntityIds: [requestId],
        data: {
          signature_name: s.presigned_signature_name ?? s.name ?? '',
          signed_at: presignedAt,
          signer_ip: null,
          presigned: true,
        },
        sourceType: 'system',
        sourceRef: sourceRefReq,
      })
    }
    await insertRelationship(client, {
      tenantId,
      actionId,
      sourceEntityId: requestId,
      targetEntityId: envelopeId,
      relationshipKindId: requestOfId,
    })
    requestIds.push(requestId)
  }

  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.sent',
    primaryEntityId: p.matter_entity_id ?? p.document_entity_id,
    secondaryEntityIds: [envelopeId, ...requestIds],
    data: {
      provider: p.provider,
      dispatched: p.dispatched,
      document_entity_id: p.document_entity_id,
      document_version_id: p.document_version_id,
      // ES-MULTIDOC-1: how many documents ride this envelope (1 for the classic
      // single-doc send). Additive — no reader depends on its absence.
      document_count: envelopeDocs.length,
      signer_count: requestIds.length,
      correlation_id: p.correlation_id,
    },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  // ES-5b (founder-priority): NO optimistic esign.delivered event at send. We
  // only dispatched the signing email — we have NOT confirmed it reached the
  // inbox — so emitting esign.delivered "at the same instant as esign.sent" was
  // a dishonest claim (a real envelope once went silently to a mistyped address
  // yet read "Delivered"). The per-recipient status now derives only from real
  // signals: the dispatch itself ("Sent to <email>"), esign.opened ("Opened"),
  // and esign.signed/declined. `deliveredAtSend` still drives the actual email
  // dispatch below; the first group's internal 'delivered' state is surfaced in
  // the UI as the honest "Sent". esign.delivered has no readers (verified), so
  // dropping the emission relabels no consumer.

  return {
    envelopeId,
    requestIds,
    deliveredRequestIds: deliveredAtSend,
    status: envelopeStatus,
    createdContacts,
  }
})

interface EsignOpenPayload {
  request_entity_id: string
  envelope_entity_id: string
  signer_ip?: string | null
}

registerActionHandler('esign.open', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignOpenPayload
  const tenantId = ctx.tenantId
  const sourceRef = `signature_request:${p.request_entity_id}`
  const status = await latestStatus(client, tenantId, p.request_entity_id)
  // Only delivered → opened (never downgrade signed/declined).
  if (status === 'delivered') {
    await setAttr(client, tenantId, actionId, p.request_entity_id, 'signer_status', 'opened', {
      sourceType: 'system',
      sourceRef,
    })
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.opened',
      primaryEntityId: p.envelope_entity_id,
      secondaryEntityIds: [p.request_entity_id],
      // The open timestamp is this event's occurred_at; signer_ip completes the
      // audit trail (PORTAL-1 WP2) — recorded on BOTH doors (portal + link).
      data: { opened_at: new Date().toISOString(), signer_ip: p.signer_ip ?? null },
      sourceType: 'system',
      sourceRef,
    })
  }
  return { requestId: p.request_entity_id, status: status === 'delivered' ? 'opened' : status }
})

interface EsignSignPayload {
  request_entity_id: string
  envelope_entity_id: string
  signature_name: string
  signature_data?: string | null
  consent_text: string
  field_values?: Record<string, string> | null
  signed_at?: string | null
  signer_ip?: string | null
}

// signature_data is capped like the attorney's standing signature
// (handlers/attorneySignature.ts MAX_SIGNATURE_IMAGE_BYTES): the attribute table is
// append-only, and the executed render inlines the image into the document body.
const MAX_SIGNATURE_IMAGE_BYTES = 500_000

// Decoded byte length of a base64 payload (¾ of the char count, minus padding) —
// the same decode math attorneySignature.ts applies to its writes.
function base64DecodedBytes(b64: string): number {
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.floor((b64.length * 3) / 4) - padding
}

interface CompleteEnvelopeResult {
  executedVersionId: string | null
  executedVersionNumber: number | null
  copyDeliveredRequestIds: string[]
}

// The completion tail: mark the envelope completed, stamp the executed copy
// of every document, drive any matter lifecycle waiting on esign.completed,
// and resolve which receives_copy requests to notify. Shared by esign.sign's
// normal completion (every needs_to_sign request resolved, no hold) and
// esign.finish_signing (ADD-NEXT-SIGNER-1 — a signer explicitly confirms "no
// more signers" after their signature held the envelope open for that
// decision) so there is exactly ONE place an envelope actually finishes.
async function completeEnvelope(
  ctx: ActionContext,
  client: DbClient,
  tenantId: string,
  actionId: string,
  envelopeId: string,
  sourceRef: string,
): Promise<CompleteEnvelopeResult> {
  await setAttr(client, tenantId, actionId, envelopeId, 'envelope_status', 'completed', {
    sourceType: 'system',
    sourceRef,
  })
  // ES-MULTIDOC-1 — write the executed copy of EVERY document in the envelope,
  // in order. Each document is its own entity with its own version chain, so
  // writeExecutedVersion runs once per document (the placement subset that lands
  // on document d is resolved inside, by docIndex). The primary (order-0)
  // document keeps driving the lifecycle + the single-value event fields so
  // every existing reader is unchanged; a single-doc envelope loops exactly once.
  const documentEntityIds = await resolveEnvelopeDocuments(client, tenantId, envelopeId)
  const documentEntityId = documentEntityIds[0] ?? null
  const executedVersionIds: string[] = []
  let executedVersionId: string | null = null
  let executedVersionNumber: number | null = null
  for (let d = 0; d < documentEntityIds.length; d++) {
    const executed = await writeExecutedVersion(
      client,
      tenantId,
      actionId,
      envelopeId,
      documentEntityIds[d]!,
    )
    executedVersionIds.push(executed.versionId)
    if (d === 0) {
      executedVersionId = executed.versionId
      executedVersionNumber = executed.versionNumber
    }
  }
  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.completed',
    primaryEntityId: documentEntityId ?? envelopeId,
    secondaryEntityIds: [envelopeId],
    data: {
      document_entity_id: documentEntityId,
      executed_document_version_id: executedVersionId,
      executed_version_number: executedVersionNumber,
      // ES-MULTIDOC-1: every executed version, in document order (length 1 for a
      // single-doc envelope). Additive alongside the primary fields above.
      executed_document_version_ids: executedVersionIds,
      document_count: documentEntityIds.length,
    },
    sourceType: 'system',
    sourceRef,
  })

  // ADR 0045 — drive any matter whose lifecycle waits ON esign.completed. The matter
  // is resolved via the signed document's draft_of link. Flag-guarded no-op when the
  // engine is off (and a no-op for a document with no matter / no waiting edge). The
  // advance commits in this same transaction under this action's id.
  if (documentEntityId) {
    const matterEntityId = await resolveDocumentMatter(client, tenantId, documentEntityId)
    if (matterEntityId) {
      await dispatchLifecycleEvent(client, ctx, matterEntityId, 'esign.completed', actionId)
    }
  }

  // ESIGN-UNIFY-1 (ES-1, §9.2/§10, 0186) — receives_copy recipients get NO link
  // at send; now that the envelope is complete, record one esign.copy_delivered
  // event per copy recipient (same shape as esign.delivered) and hand their
  // request ids back so the api layer can queue the executed-copy email
  // (notifications are a side effect of the action layer, never written from
  // inside a handler — see notifyCopyDelivered in api/esign.ts).
  const copyDeliveredRequestIds = await loadCopyRecipientRequests(client, tenantId, envelopeId)
  for (const requestId of copyDeliveredRequestIds) {
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.copy_delivered',
      primaryEntityId: envelopeId,
      secondaryEntityIds: [requestId],
      sourceType: 'system',
      sourceRef,
    })
  }

  return { executedVersionId, executedVersionNumber, copyDeliveredRequestIds }
}

registerActionHandler('esign.sign', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignSignPayload
  const tenantId = ctx.tenantId
  const signedAt = p.signed_at ?? new Date().toISOString()
  const sourceRef = `signature_request:${p.request_entity_id}`

  // signature_data arrives through the PUBLIC token door (/api/sign/submit) and the
  // portal door; this handler is the one choke point both funnel into, so it is
  // where the value is validated. Anything that is not the typed name verbatim must
  // be a real PNG/JPEG data URL within the standing-signature cap — otherwise any
  // token holder could append arbitrary multi-MB strings into append-only storage
  // and blow the executed document past the render/mail size cap.
  if (p.signature_data && p.signature_data !== p.signature_name) {
    const valid =
      isSignatureImageDataUrl(p.signature_data) &&
      base64DecodedBytes(p.signature_data.slice(p.signature_data.indexOf(',') + 1)) <=
        MAX_SIGNATURE_IMAGE_BYTES
    if (!valid) {
      throw new Error(
        'The signature image is invalid or too large — draw or upload a PNG/JPEG under 500KB.',
      )
    }
  }

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)

  await setAttr(client, tenantId, actionId, p.request_entity_id, 'signer_status', 'signed', {
    sourceRef,
  })
  await setAttr(client, tenantId, actionId, p.request_entity_id, 'signed_at', signedAt, {
    sourceRef,
  })
  await setAttr(client, tenantId, actionId, p.request_entity_id, 'signer_consent', p.consent_text, {
    sourceRef,
  })
  await setAttr(
    client,
    tenantId,
    actionId,
    p.request_entity_id,
    'signature_data',
    p.signature_data ?? p.signature_name,
    { sourceRef },
  )
  if (p.field_values) {
    await setAttr(client, tenantId, actionId, p.request_entity_id, 'field_values', p.field_values, {
      sourceRef,
    })
  }

  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.signed',
    primaryEntityId: p.envelope_entity_id,
    secondaryEntityIds: [p.request_entity_id],
    // signer_ip completes the audit trail (PORTAL-1 WP2): delivery address =
    // signer_email attr, open = esign.opened, sign = signed_at, IP = here.
    data: { signature_name: p.signature_name, signed_at: signedAt, signer_ip: p.signer_ip ?? null },
    sourceType: 'human',
    sourceRef,
  })

  // Advance routing: deliver the next group, or complete when all have signed.
  const { delivered, completed } = await deliverNextGroup(
    client,
    tenantId,
    actionId,
    p.envelope_entity_id,
    sourceRef,
  )

  if (!completed) {
    return {
      envelopeId: p.envelope_entity_id,
      status: 'signed' as const,
      completed: false,
      deliveredRequestIds: delivered,
    }
  }

  // ADD-NEXT-SIGNER-1 — this signature would otherwise finish the envelope.
  // If the role that just signed opted into "let me add the next signer",
  // hold completion open and ask instead of auto-completing (Joe's call: an
  // open-ended signer count needs an explicit "no more signers", not a close
  // the instant the last KNOWN signer finishes).
  if (
    shouldHoldForAddDecision(await signerAllowsAddNext(client, tenantId, p.request_entity_id), true)
  ) {
    await setAttr(
      client,
      tenantId,
      actionId,
      p.envelope_entity_id,
      'envelope_status',
      'awaiting_signer_decision',
      { sourceType: 'system', sourceRef },
    )
    return {
      envelopeId: p.envelope_entity_id,
      status: 'signed' as const,
      completed: false,
      deliveredRequestIds: [],
      awaitingAddDecision: true,
    }
  }

  const done = await completeEnvelope(
    ctx,
    client,
    tenantId,
    actionId,
    p.envelope_entity_id,
    sourceRef,
  )
  return {
    envelopeId: p.envelope_entity_id,
    status: 'completed' as const,
    completed: true,
    deliveredRequestIds: [],
    executedDocumentVersionId: done.executedVersionId,
    executedVersionNumber: done.executedVersionNumber,
    copyDeliveredRequestIds: done.copyDeliveredRequestIds,
  }
})

interface EsignDeclinePayload {
  request_entity_id: string
  envelope_entity_id: string
  reason?: string | null
  signer_ip?: string | null
}

registerActionHandler('esign.decline', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignDeclinePayload
  const tenantId = ctx.tenantId
  const sourceRef = `signature_request:${p.request_entity_id}`

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  await setAttr(client, tenantId, actionId, p.request_entity_id, 'signer_status', 'declined', {
    sourceRef,
  })
  await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'declined', {
    sourceType: 'system',
    sourceRef,
  })
  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.declined',
    primaryEntityId: p.envelope_entity_id,
    secondaryEntityIds: [p.request_entity_id],
    data: { reason: p.reason ?? null, signer_ip: p.signer_ip ?? null },
    sourceType: 'human',
    sourceRef,
  })
  return { envelopeId: p.envelope_entity_id, status: 'declined' as const }
})

interface EsignVoidPayload {
  envelope_entity_id: string
  reason?: string | null
}

// esign.void — the FIRM pulls an active envelope back before completion. Sets the
// envelope to 'voided' and closes every still-open signer request (pending |
// delivered | opened) → 'voided', so assertSignerTurn rejects any further sign
// from a stale link. Completed / declined / already-voided envelopes are refused.
registerActionHandler('esign.void', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignVoidPayload
  const tenantId = ctx.tenantId
  const sourceRef = ctx.actorId

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  const current = await latestEnvelopeStatus(client, tenantId, p.envelope_entity_id)
  if (current === 'completed' || current === 'declined' || current === 'voided') {
    throw new Error(`Envelope is already ${current} and cannot be voided.`)
  }

  const reqs = await loadRoutingRequests(client, tenantId, p.envelope_entity_id)
  const openRequestIds = reqs
    .filter((r) => r.status !== 'signed' && r.status !== 'declined' && r.status !== 'voided')
    .map((r) => r.requestId)
  for (const requestId of openRequestIds) {
    await setAttr(client, tenantId, actionId, requestId, 'signer_status', 'voided', {
      sourceType: 'system',
      sourceRef,
    })
  }
  await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'voided', {
    sourceRef,
  })

  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.voided',
    primaryEntityId: p.envelope_entity_id,
    secondaryEntityIds: openRequestIds,
    data: { reason: p.reason ?? null, closed_request_count: openRequestIds.length },
    sourceType: 'human',
    sourceRef,
  })
  return {
    envelopeId: p.envelope_entity_id,
    status: 'voided' as const,
    voidedRequestIds: openRequestIds,
  }
})

interface EsignAddSignerPayload {
  envelope_entity_id: string
  /** The request to insert right after (Joe's design: right after the
   *  anchor, ahead of anything already queued later). A signer adding the
   *  next signer passes their OWN just-signed request; an attorney add
   *  omits it — anchors after whichever group is currently active, or after
   *  everyone if nothing is unresolved. */
  anchor_request_entity_id?: string | null
  name: string
  email: string
  title?: string | null
  channel?: 'portal' | 'link' | null
}

// esign.add_signer (ADD-NEXT-SIGNER-1) — insert a NEW needs_to_sign request
// mid-envelope: a signer whose role opted in ("add the next signer"), or the
// attorney's own "add signer" on an in-flight envelope. Never rewrites any
// existing request's order (attribute history is append-only) — the new
// request gets an order strictly between the anchor and whatever was already
// queued past it (nextInsertionOrder, esign/routing.ts). Reuses
// deliverNextGroup so the new request is promoted to 'delivered' immediately
// when it is now the earliest unresolved group — the exact same rule any
// other pending request is promoted by.
registerActionHandler('esign.add_signer', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignAddSignerPayload
  const tenantId = ctx.tenantId
  const sourceRef = ctx.actorId

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  const current = await latestEnvelopeStatus(client, tenantId, p.envelope_entity_id)
  if (current === 'completed' || current === 'declined' || current === 'voided') {
    throw new Error(`Envelope is already ${current} — no more signers can be added.`)
  }

  const reqs = await loadRoutingRequests(client, tenantId, p.envelope_entity_id)
  const signingOrders = reqs.filter((r) => r.role === 'needs_to_sign').map((r) => r.order)
  let anchorOrder: number
  if (p.anchor_request_entity_id) {
    const anchor = reqs.find((r) => r.requestId === p.anchor_request_entity_id)
    if (!anchor) throw new Error(`signature_request not found: ${p.anchor_request_entity_id}`)
    anchorOrder = anchor.order
  } else {
    const unresolved = reqs.filter(
      (r) => r.role === 'needs_to_sign' && r.status !== 'signed' && r.status !== 'declined',
    )
    anchorOrder =
      unresolved.length > 0
        ? Math.min(...unresolved.map((r) => r.order))
        : Math.max(0, ...signingOrders)
  }
  const order = nextInsertionOrder(signingOrders, anchorOrder)

  const requestKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    tenantId,
    'signature_request',
  )
  const requestOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    tenantId,
    'request_of',
  )
  const requestId = await insertEntity(
    client,
    tenantId,
    actionId,
    requestKindId,
    p.name || p.email,
    {
      email: p.email,
    },
  )
  await setAttr(client, tenantId, actionId, requestId, 'signer_email', p.email, { sourceRef })
  if (p.name)
    await setAttr(client, tenantId, actionId, requestId, 'signer_name', p.name, { sourceRef })
  if (p.title)
    await setAttr(client, tenantId, actionId, requestId, 'signer_title', p.title, { sourceRef })
  await setAttr(client, tenantId, actionId, requestId, 'signer_order', order, { sourceRef })
  await setAttr(client, tenantId, actionId, requestId, 'signer_channel', p.channel ?? 'link', {
    sourceRef,
  })
  await setAttr(client, tenantId, actionId, requestId, 'signer_role', 'needs_to_sign', {
    sourceRef,
  })
  await setAttr(client, tenantId, actionId, requestId, 'signer_status', 'pending', { sourceRef })
  await insertRelationship(client, {
    tenantId,
    actionId,
    sourceEntityId: requestId,
    targetEntityId: p.envelope_entity_id,
    relationshipKindId: requestOfId,
  })

  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.signer_added',
    primaryEntityId: p.envelope_entity_id,
    secondaryEntityIds: [requestId],
    data: { name: p.name || null, email: p.email, order },
    sourceType: 'human',
    sourceRef,
  })

  // The hold (if any) is resolved by a REAL next signer existing now — flip
  // back to 'sent' unconditionally (a no-op write if it was already 'sent').
  if (current === 'awaiting_signer_decision') {
    await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'sent', {
      sourceType: 'system',
      sourceRef,
    })
  }

  // Promote the new request to 'delivered' if it is now the earliest
  // unresolved group — same rule (and same helper) any other pending
  // request is promoted by after a sign. Never reports completed=true: we
  // just added an unresolved needs_to_sign request, so it can't be.
  const { delivered } = await deliverNextGroup(
    client,
    tenantId,
    actionId,
    p.envelope_entity_id,
    sourceRef,
  )

  return { envelopeId: p.envelope_entity_id, requestId, deliveredRequestIds: delivered }
})

interface EsignFinishSigningPayload {
  envelope_entity_id: string
  /** The signer confirming "no more signers" — used only for the audit
   *  sourceRef. Omitted for the attorney's fallback finish. */
  request_entity_id?: string | null
}

// esign.finish_signing (ADD-NEXT-SIGNER-1) — the deferred completion a
// signer's "no more signers" confirms, or the attorney's fallback finish for
// an envelope stuck awaiting that decision. Only valid while the envelope is
// actually in the hold: refuses a normal in-flight envelope (nothing to
// finish early) and an already-completed one (no double-completion).
registerActionHandler('esign.finish_signing', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignFinishSigningPayload
  const tenantId = ctx.tenantId
  const sourceRef = p.request_entity_id ? `signature_request:${p.request_entity_id}` : ctx.actorId

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  const current = await latestEnvelopeStatus(client, tenantId, p.envelope_entity_id)
  if (current !== 'awaiting_signer_decision') {
    throw new Error(
      `Envelope is not awaiting a signer decision (status: ${current}) — nothing to finish.`,
    )
  }

  const done = await completeEnvelope(
    ctx,
    client,
    tenantId,
    actionId,
    p.envelope_entity_id,
    sourceRef,
  )
  return {
    envelopeId: p.envelope_entity_id,
    status: 'completed' as const,
    completed: true,
    executedDocumentVersionId: done.executedVersionId,
    executedVersionNumber: done.executedVersionNumber,
    copyDeliveredRequestIds: done.copyDeliveredRequestIds,
  }
})

// ── External provider callback (dormant) ─────────────────────────────────────

interface EsignRecordStatusPayload {
  envelope_entity_id: string
  provider_envelope_ref?: string | null
  status: 'signed' | 'completed' | 'declined'
  signer_email?: string | null
  executed_document?: { content_type: string; body: string } | null
  raw_event_log_id?: string | null
  source_ref?: string | null
}

registerActionHandler('esign.record_status', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignRecordStatusPayload
  const tenantId = ctx.tenantId
  const sourceRef = p.source_ref ?? 'integration:esign'

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  const documentEntityId = await resolveEnvelopeDocument(client, tenantId, p.envelope_entity_id)

  let signerRequestId: string | null = null
  if (p.signer_email) {
    signerRequestId = await findSignerRequest(
      client,
      tenantId,
      p.envelope_entity_id,
      p.signer_email,
    )
    if (signerRequestId) {
      const signerState = p.status === 'declined' ? 'declined' : 'signed'
      await setAttr(client, tenantId, actionId, signerRequestId, 'signer_status', signerState, {
        sourceType: 'integration',
        sourceRef,
      })
    }
  }

  if (p.status === 'signed') {
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.signed',
      primaryEntityId: p.envelope_entity_id,
      secondaryEntityIds: signerRequestId ? [signerRequestId] : [],
      data: {
        signer_email: p.signer_email ?? null,
        provider_envelope_ref: p.provider_envelope_ref ?? null,
      },
      sourceType: 'integration',
      sourceRef,
    })
    return { envelopeId: p.envelope_entity_id, status: 'signed' as const }
  }

  if (p.status === 'declined') {
    await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'declined', {
      sourceType: 'integration',
      sourceRef,
    })
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.declined',
      primaryEntityId: p.envelope_entity_id,
      secondaryEntityIds: signerRequestId ? [signerRequestId] : [],
      data: { signer_email: p.signer_email ?? null },
      sourceType: 'integration',
      sourceRef,
    })
    return { envelopeId: p.envelope_entity_id, status: 'declined' as const }
  }

  await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'completed', {
    sourceType: 'integration',
    sourceRef,
  })
  let executedVersionId: string | null = null
  if (p.executed_document && documentEntityId) {
    const contentBlobId = await insertContentBlob(client, {
      tenantId,
      actionId,
      contentType: p.executed_document.content_type || 'application/pdf',
      body: p.executed_document.body,
    })
    const versionNumber = (await maxVersionNumber(client, tenantId, documentEntityId)) + 1
    executedVersionId = await insertDocumentVersion(client, {
      tenantId,
      actionId,
      documentEntityId,
      contentBlobId,
      versionNumber,
      status: 'approved',
      reasoningTraceId: null,
      metadata: {
        executed: true,
        executed_from_envelope_id: p.envelope_entity_id,
        provider_envelope_ref: p.provider_envelope_ref ?? null,
        source: 'esign-external',
      },
    })
  }
  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.completed',
    primaryEntityId: documentEntityId ?? p.envelope_entity_id,
    secondaryEntityIds: [p.envelope_entity_id],
    data: {
      provider_envelope_ref: p.provider_envelope_ref ?? null,
      document_entity_id: documentEntityId,
    },
    sourceType: 'integration',
    sourceRef,
  })
  return {
    envelopeId: p.envelope_entity_id,
    status: 'completed' as const,
    executedDocumentVersionId: executedVersionId,
  }
})

// ── helpers ──────────────────────────────────────────────────────────────────

async function setAttr(
  client: DbClient,
  tenantId: string,
  actionId: string,
  entityId: string,
  attributeKindName: string,
  value: unknown,
  opts?: { sourceType?: 'human' | 'integration' | 'agent' | 'system'; sourceRef?: string | null },
): Promise<void> {
  const attributeKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    tenantId,
    attributeKindName,
  )
  await insertAttribute(client, {
    tenantId,
    actionId,
    entityId,
    attributeKindId,
    value,
    confidence: 1.0,
    sourceType: opts?.sourceType ?? 'human',
    sourceRef: opts?.sourceRef ?? null,
  })
}

async function assertEnvelopeExists(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<void> {
  const res = await client.query<{ id: string }>(
    `SELECT e.id FROM entity e
       JOIN entity_kind_definition ekd ON ekd.id = e.entity_kind_id
      WHERE e.tenant_id = $1 AND e.id = $2 AND ekd.kind_name = 'signature_envelope'`,
    [tenantId, envelopeId],
  )
  if (!res.rows[0]) throw new Error(`signature_envelope not found: ${envelopeId}`)
}

async function latestStatus(
  client: DbClient,
  tenantId: string,
  requestId: string,
): Promise<string> {
  const res = await client.query<{ status: string }>(
    `SELECT a.value #>> '{}' AS status FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'signer_status'
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, requestId],
  )
  return res.rows[0]?.status ?? 'pending'
}

async function latestEnvelopeStatus(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<string> {
  const res = await client.query<{ status: string }>(
    `SELECT a.value #>> '{}' AS status FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'envelope_status'
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, envelopeId],
  )
  return res.rows[0]?.status ?? 'pending_dispatch'
}

// ADD-NEXT-SIGNER-1 — whether THIS request's role opted into "let me add the
// next signer" (written only when true at send/insert time — see
// signer_allow_add_next in esign.send/esign.add_signer below); absent reads
// as false, the safe default for every request written before this feature.
async function signerAllowsAddNext(
  client: DbClient,
  tenantId: string,
  requestId: string,
): Promise<boolean> {
  const res = await client.query<{ v: string }>(
    `SELECT a.value #>> '{}' AS v FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'signer_allow_add_next'
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, requestId],
  )
  return res.rows[0]?.v === 'true'
}

// ES-MULTIDOC-1 — every document linked to the envelope, in send order (the
// `order` written into each envelope_of relationship's properties; legacy
// single-doc envelopes have one row whose absent order reads as 0). The order
// tiebreaker is recorded_at so a pre-multidoc envelope (no order key) is stable.
async function resolveEnvelopeDocuments(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<string[]> {
  const res = await client.query<{ document_id: string }>(
    `SELECT r.target_entity_id AS document_id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = 'envelope_of'
        AND (r.valid_to IS NULL OR r.valid_to > now())
      ORDER BY COALESCE((r.properties->>'order')::int, 0), r.recorded_at`,
    [tenantId, envelopeId],
  )
  return res.rows.map((row) => row.document_id)
}

// The primary (order-0) document — what the lifecycle dispatch, the matter
// resolution, and every single-doc reader key on. Deterministic now that an
// envelope can carry many documents (ordered by the same rule).
async function resolveEnvelopeDocument(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<string | null> {
  const docs = await resolveEnvelopeDocuments(client, tenantId, envelopeId)
  return docs[0] ?? null
}

// The matter a signed document belongs to, via the draft_of relationship
// (document → matter; written by the drafting flow). Returns null for a document
// not tied to a matter (e.g. a standalone signature). ADR 0045: used to dispatch
// the esign.completed lifecycle signal to the right matter.
async function resolveDocumentMatter(
  client: DbClient,
  tenantId: string,
  documentEntityId: string,
): Promise<string | null> {
  const res = await client.query<{ matter_id: string }>(
    `SELECT r.target_entity_id AS matter_id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = 'draft_of'
        AND (r.valid_to IS NULL OR r.valid_to > now())
      LIMIT 1`,
    [tenantId, documentEntityId],
  )
  return res.rows[0]?.matter_id ?? null
}

async function findSignerRequest(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
  signerEmail: string,
): Promise<string | null> {
  const res = await client.query<{ request_id: string }>(
    `SELECT r.source_entity_id AS request_id
       FROM relationship r
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
       JOIN attribute a ON a.entity_id = r.source_entity_id AND a.tenant_id = r.tenant_id
       JOIN attribute_kind_definition akd
         ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_email'
      WHERE r.tenant_id = $1 AND r.target_entity_id = $2
        AND lower(a.value #>> '{}') = lower($3)
        AND (a.valid_to IS NULL OR a.valid_to > now())
      LIMIT 1`,
    [tenantId, envelopeId, signerEmail],
  )
  return res.rows[0]?.request_id ?? null
}

async function maxVersionNumber(
  client: DbClient,
  tenantId: string,
  documentEntityId: string,
): Promise<number> {
  const res = await client.query<{ max: number | null }>(
    `SELECT max(version_number) AS max FROM document_version
      WHERE tenant_id = $1 AND document_entity_id = $2`,
    [tenantId, documentEntityId],
  )
  return res.rows[0]?.max ?? 0
}

interface RoutingRequest {
  requestId: string
  order: number
  status: string
  role: SignerRole
}

async function loadRoutingRequests(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<RoutingRequest[]> {
  const res = await client.query<{ request_id: string; ord: string; status: string; role: string }>(
    `SELECT r.source_entity_id AS request_id,
        COALESCE((SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name='signer_order'
            WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
            ORDER BY a.valid_from DESC LIMIT 1), '1') AS ord,
        COALESCE((SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name='signer_status'
            WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
            ORDER BY a.valid_from DESC LIMIT 1), 'pending') AS status,
        COALESCE((SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name='signer_role'
            WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
            ORDER BY a.valid_from DESC LIMIT 1), 'needs_to_sign') AS role
     FROM relationship r
     JOIN relationship_kind_definition rkd
       ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
     WHERE r.tenant_id = $1 AND r.target_entity_id = $2
       AND (r.valid_to IS NULL OR r.valid_to > now())`,
    [tenantId, envelopeId],
  )
  return res.rows.map((row) => ({
    requestId: row.request_id,
    order: Number(row.ord) || 1,
    status: row.status,
    role: normalizeRole(row.role),
  }))
}

// Deliver the lowest-order routing group that still has pending signers. Returns
// the newly-delivered request ids and whether the envelope is now fully signed.
// Pure-sequential (distinct orders) and pure-parallel (one order) both fall out
// of this: a group becomes active only once every prior group has signed.
//
// ESIGN-UNIFY-1 (ES-1, §9.2) — the decision is planNextDelivery (pure,
// esign/routing.ts): "all signers signed" iterates ONLY needs_to_sign
// requests; needs_to_view was delivered once at send (never re-delivered
// here) and never blocks completion; receives_copy is never delivered here
// (notified separately once the envelope completes — see esign.sign above).
async function deliverNextGroup(
  client: DbClient,
  tenantId: string,
  actionId: string,
  envelopeId: string,
  sourceRef: string,
): Promise<{ delivered: string[]; completed: boolean }> {
  const reqs = await loadRoutingRequests(client, tenantId, envelopeId)
  const plan = planNextDelivery(reqs)
  if (plan.completed) return { delivered: [], completed: true }
  const delivered: string[] = []
  for (const requestId of plan.deliver) {
    await setAttr(client, tenantId, actionId, requestId, 'signer_status', 'delivered', {
      sourceType: 'system',
      sourceRef,
    })
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.delivered',
      primaryEntityId: envelopeId,
      secondaryEntityIds: [requestId],
      sourceType: 'system',
      sourceRef,
    })
    delivered.push(requestId)
  }
  return { delivered, completed: false }
}

// The receives_copy requests on an envelope — resolved separately from
// deliverNextGroup (which only ever looks at needs_to_sign requests) because
// copy recipients are notified once, at completion, regardless of routing.
async function loadCopyRecipientRequests(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<string[]> {
  return copyRecipients(await loadRoutingRequests(client, tenantId, envelopeId))
}

// The latest NON-executed version — the original we are executing. For a
// markdown draft, `body` IS the content; for an uploaded file (0170), `body` is
// the storage object key and the file's identity (MIME, byte hash, size) rides
// the version metadata / content_blob columns.
interface OriginalVersion {
  body: string
  objectKey: string | null
  contentType: string | null
  filename: string | null
  sha256Hex: string | null
  sizeBytes: number | null
}

async function loadOriginalVersion(
  client: DbClient,
  tenantId: string,
  documentEntityId: string,
): Promise<OriginalVersion> {
  const res = await client.query<{
    body: string
    object_key: string | null
    content_type: string | null
    original_filename: string | null
    sha256_hex: string | null
    size_bytes: string | null
  }>(
    `SELECT cb.body,
            dv.metadata->>'object_key' AS object_key,
            COALESCE(dv.metadata->>'content_type', cb.content_type) AS content_type,
            dv.metadata->>'original_filename' AS original_filename,
            encode(cb.sha256, 'hex') AS sha256_hex,
            dv.metadata->>'size_bytes' AS size_bytes
       FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
      WHERE dv.tenant_id = $1 AND dv.document_entity_id = $2
        AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
      ORDER BY dv.version_number DESC
      LIMIT 1`,
    [tenantId, documentEntityId],
  )
  const row = res.rows[0]
  return {
    body: row?.body ?? '',
    objectKey: row?.object_key ?? null,
    contentType: row?.content_type ?? null,
    filename: row?.original_filename ?? null,
    sha256Hex: row?.sha256_hex ?? null,
    sizeBytes: row?.size_bytes ? Number(row.size_bytes) : null,
  }
}

interface FullSigner {
  key: string | null
  name: string | null
  email: string | null
  title: string | null
  signed_at: string | null
  consent: string | null
  // Typed name (legacy/typed adoption) OR a data-URL image (P15 standing
  // signature) — fieldValue's 'sign' branch distinguishes the two.
  signature_data: string | null
  field_values: Record<string, string> | null
}

async function loadEnvelopeSigners(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<FullSigner[]> {
  const a = (k: string) =>
    `(SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
        ON akd.id = a.attribute_kind_id AND akd.kind_name = '${k}'
        WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
        ORDER BY a.valid_from DESC LIMIT 1)`
  const res = await client.query<FullSigner & { field_values_json: string | null }>(
    `SELECT ${a('signer_key')} AS key, ${a('signer_name')} AS name, ${a('signer_email')} AS email,
            ${a('signer_title')} AS title, ${a('signed_at')} AS signed_at, ${a('signer_consent')} AS consent,
            ${a('signature_data')} AS signature_data,
            (SELECT a.value::text FROM attribute a JOIN attribute_kind_definition akd
               ON akd.id = a.attribute_kind_id AND akd.kind_name = 'field_values'
               WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
               ORDER BY a.valid_from DESC LIMIT 1) AS field_values_json
     FROM relationship r
     JOIN relationship_kind_definition rkd
       ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
     WHERE r.tenant_id = $1 AND r.target_entity_id = $2
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY r.recorded_at`,
    [tenantId, envelopeId],
  )
  return res.rows.map((row) => ({
    key: row.key,
    name: row.name,
    email: row.email,
    title: row.title,
    signed_at: row.signed_at,
    consent: row.consent,
    signature_data: row.signature_data,
    field_values: row.field_values_json
      ? (JSON.parse(row.field_values_json) as Record<string, string>)
      : null,
  }))
}

function fieldValue(
  field: EsignField,
  signer: FullSigner | undefined,
  // Per-render: signer keys whose image signature is already inlined. A document
  // can carry many {{sign:key}} tags for one signer; inlining the data URL at
  // every one multiplies the executed body's size (the 500 KB cap bounds ONE
  // copy, renderDraftPdf's mail cap bounds the whole body), so only the FIRST
  // sign field per signer gets the image — repeats render the /s/ glyph alone.
  inlinedImageSigners: Set<string>,
): string {
  const v = signer?.field_values?.[field.id]
  switch (field.type) {
    case 'name':
      return signer?.name ?? ''
    case 'date':
      return (signer?.signed_at ?? '').slice(0, 10)
    case 'title':
      return v ?? signer?.title ?? ''
    case 'sign': {
      // P15: a drawn/uploaded standing signature arrives as a data-URL image in
      // signature_data — render it as a markdown image with the /s/ glyph beside
      // it (the display sanitizer strips <img>, so the glyph is what shows
      // there; the image survives in the stored markdown). Typed signatures
      // (or the legacy typed-name fallback in signature_data) stay glyph-only.
      const sig = signer?.signature_data
      const name = v ?? signer?.name ?? ''
      if (sig && isSignatureImageDataUrl(sig) && !inlinedImageSigners.has(field.signerKey)) {
        inlinedImageSigners.add(field.signerKey)
        return renderImageSignature(sig, name)
      }
      return renderTypedSignature(name)
    }
    case 'check':
      return v ? '☑' : '☐'
    default:
      return v ?? ''
  }
}

// Build + persist the executed copy: every field tag resolved to its value, plus
// a signature certificate carrying the original content's SHA-256 (tamper-
// evidence), as a NEW immutable document_version.
async function writeExecutedVersion(
  client: DbClient,
  tenantId: string,
  actionId: string,
  envelopeId: string,
  documentEntityId: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const original = await loadOriginalVersion(client, tenantId, documentEntityId)
  const signers = await loadEnvelopeSigners(client, tenantId, envelopeId)

  // 0170 — uploaded-file envelope: the original's body is a storage object key,
  // not signable text, and there is no PDF field-stamping path (the markdown tag
  // model doesn't apply). The executed artifact is the SIGNATURE CERTIFICATE
  // itself: a markdown version binding the signers' adoptions to the exact file
  // bytes via the SHA-256 recorded at upload. The file is untouched (immutable
  // in Storage); tamper-evidence is the hash, same doctrine as the markdown path.
  if (original.objectKey) {
    const cert = buildFileCertificateMarkdown({
      envelopeId,
      filename: original.filename,
      contentType: original.contentType,
      sizeBytes: original.sizeBytes,
      sha256Hex: original.sha256Hex,
      signers,
    })
    const contentBlobId = await insertContentBlob(client, {
      tenantId,
      actionId,
      contentType: 'text/markdown',
      body: cert,
    })
    const versionNumber = (await maxVersionNumber(client, tenantId, documentEntityId)) + 1
    const versionId = await insertDocumentVersion(client, {
      tenantId,
      actionId,
      documentEntityId,
      contentBlobId,
      versionNumber,
      status: 'approved',
      reasoningTraceId: null,
      metadata: {
        executed: true,
        executed_from_envelope_id: envelopeId,
        original_sha256: original.sha256Hex,
        original_object_key: original.objectKey,
        original_content_type: original.contentType,
        original_filename: original.filename,
        source: 'esign-native',
        signers: signers.map((s) => ({
          name: s.name,
          email: s.email,
          title: s.title,
          signed_at: s.signed_at,
        })),
      },
    })
    return { versionId, versionNumber }
  }

  const fields = await loadEnvelopeFields(client, tenantId, envelopeId)
  const originalSha = createHash('sha256').update(original.body, 'utf8').digest('hex')

  // Resolve each field tag (in the body) to its signer's value.
  const signerByKey = new Map<string, FullSigner>()
  for (const s of signers) if (s.key) signerByKey.set(s.key, s)
  const valuesById: Record<string, string> = {}
  // Fields resolve in appearance order (loadEnvelopeFields preserves the parse
  // order), so "first sign field per signer" is the first tag in the document.
  const inlinedImageSigners = new Set<string>()
  for (const f of fields)
    valuesById[f.id] = fieldValue(f, signerByKey.get(f.signerKey), inlinedImageSigners)
  const filledBody = fields.length
    ? resolveExecutedMarkdown(original.body, valuesById)
    : original.body

  const cert = [
    '',
    '',
    '---',
    '',
    '## Signature Certificate',
    '',
    'This document was executed electronically via Pacheco Law. Each signer below',
    'reviewed the document and adopted their signature with intent to sign.',
    '',
    ...signers.map(
      (sgn) =>
        `- **${sgn.name ?? sgn.email ?? 'Signer'}**${sgn.title ? `, ${sgn.title}` : ''} (${
          sgn.email ?? '—'
        }) — signed ${sgn.signed_at ?? '—'}\n  Consent: "${sgn.consent ?? '—'}"`,
    ),
    '',
    `**Original content SHA-256:** \`${originalSha}\``,
    `**Envelope:** \`${envelopeId}\``,
    '',
  ].join('\n')

  const contentBlobId = await insertContentBlob(client, {
    tenantId,
    actionId,
    contentType: 'text/markdown',
    body: `${filledBody}${cert}`,
  })
  const versionNumber = (await maxVersionNumber(client, tenantId, documentEntityId)) + 1
  const versionId = await insertDocumentVersion(client, {
    tenantId,
    actionId,
    documentEntityId,
    contentBlobId,
    versionNumber,
    status: 'approved',
    reasoningTraceId: null,
    metadata: {
      executed: true,
      executed_from_envelope_id: envelopeId,
      original_sha256: originalSha,
      source: 'esign-native',
      signers: signers.map((s) => ({
        name: s.name,
        email: s.email,
        title: s.title,
        signed_at: s.signed_at,
      })),
    },
  })
  return { versionId, versionNumber }
}

async function loadEnvelopeFields(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<EsignField[]> {
  const res = await client.query<{ value: string }>(
    `SELECT a.value::text AS value FROM attribute a
       JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id
      WHERE a.tenant_id = $1 AND a.entity_id = $2 AND akd.kind_name = 'envelope_fields'
      ORDER BY a.valid_from DESC LIMIT 1`,
    [tenantId, envelopeId],
  )
  if (!res.rows[0]?.value) return []
  try {
    return JSON.parse(res.rows[0].value) as EsignField[]
  } catch {
    return []
  }
}
