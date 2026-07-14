// E-signature action handlers (Session 5). All writes flow through these
// handlers under submitAction (vertical CLAUDE.md). Provider-agnostic: nothing
// here names a provider — it is an attribute value. Native sign-by-link with
// DocuSign-style fields, per-signer titles, sequential routing, and delivered/
// opened/signed status.
//
//   esign.send     → create signature_envelope (+ one signature_request per
//                    signer: key/title/order/channel), store the field plan,
//                    deliver the first routing group. esign.sent + esign.delivered.
//   esign.open     → a signer opened their document (delivered → opened). esign.opened.
//   esign.sign     → a signer adopts their signature + fills their fields. When
//                    the current routing group finishes, the next group is
//                    delivered (esign.delivered); when ALL sign, the envelope
//                    completes and the executed copy — every field tag resolved
//                    + a signature certificate with the original content SHA-256 —
//                    is written as a NEW immutable document_version (invariant 14).
//   esign.decline  → a signer declines; the envelope closes. esign.declined.
//   esign.record_status → EXTERNAL (dormant): same transitions for a future driver.
import { createHash } from 'node:crypto'
import { registerActionHandler } from '@exsto/substrate'
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
import { dispatchLifecycleEvent } from '../lifecycle/executor.js'

interface SendSigner {
  email: string
  name?: string | null
  key?: string | null
  title?: string | null
  order?: number | null
  channel?: 'portal' | 'link' | null
  signer_provider_ref?: string | null
}

interface EsignSendPayload {
  document_entity_id: string
  document_version_id: string
  matter_entity_id?: string | null
  provider: string
  provider_envelope_ref?: string | null
  dispatched: boolean
  correlation_id: string
  subject: string
  signers: SendSigner[]
  /** The parsed field plan for the document (anchor tags). */
  fields?: EsignField[]
}

registerActionHandler('esign.send', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignSendPayload
  const tenantId = ctx.tenantId

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

  const envelopeOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    tenantId,
    'envelope_of',
  )
  await insertRelationship(client, {
    tenantId,
    actionId,
    sourceEntityId: envelopeId,
    targetEntityId: p.document_entity_id,
    relationshipKindId: envelopeOfId,
    properties: { document_version_id: p.document_version_id },
  })

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
  // The lowest routing order is the group delivered at send time (sequential
  // routing delivers group 1; pure-parallel envelopes share one order).
  const firstOrder = Math.min(...p.signers.map((sg, ix) => Number(sg.order ?? ix + 1) || 1))
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
    // BUILDER-CERT-1 (WP4) — write each signer's INITIAL status exactly once.
    // The first routing group starts 'delivered' directly; later groups start
    // 'pending' (deliverNextGroup promotes them on later sign actions). The old
    // shape (write 'pending', then deliverNextGroup overwrites 'delivered' in the
    // SAME transaction) produced two open attribute rows with an identical
    // valid_from — an UNDEFINED current state that the first workflow-driven
    // e-sign run hit for real: latestAttr read back 'pending' and
    // assertSignerTurn blocked the envelope's only signer forever.
    const signerOrder = Number(s.order ?? i + 1) || 1
    const initialStatus = signerOrder === firstOrder ? 'delivered' : 'pending'
    await setAttr(client, tenantId, actionId, requestId, 'signer_status', initialStatus, {
      sourceRef: ctx.actorId,
    })
    if (initialStatus === 'delivered') deliveredAtSend.push(requestId)
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
      signer_count: requestIds.length,
      correlation_id: p.correlation_id,
    },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  // The first routing group was initialized as delivered above (one status write
  // per request); record the delivery events it used to get from deliverNextGroup.
  for (const requestId of deliveredAtSend) {
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.delivered',
      primaryEntityId: envelopeId,
      secondaryEntityIds: [requestId],
      sourceType: 'system',
      sourceRef: ctx.actorId,
    })
  }

  return { envelopeId, requestIds, deliveredRequestIds: deliveredAtSend, status: envelopeStatus }
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

  await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'completed', {
    sourceType: 'system',
    sourceRef,
  })
  const documentEntityId = await resolveEnvelopeDocument(client, tenantId, p.envelope_entity_id)
  let executedVersionId: string | null = null
  let executedVersionNumber: number | null = null
  if (documentEntityId) {
    const executed = await writeExecutedVersion(
      client,
      tenantId,
      actionId,
      p.envelope_entity_id,
      documentEntityId,
    )
    executedVersionId = executed.versionId
    executedVersionNumber = executed.versionNumber
  }
  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.completed',
    primaryEntityId: documentEntityId ?? p.envelope_entity_id,
    secondaryEntityIds: [p.envelope_entity_id],
    data: {
      document_entity_id: documentEntityId,
      executed_document_version_id: executedVersionId,
      executed_version_number: executedVersionNumber,
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
  return {
    envelopeId: p.envelope_entity_id,
    status: 'completed' as const,
    completed: true,
    deliveredRequestIds: [],
    executedDocumentVersionId: executedVersionId,
    executedVersionNumber,
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

async function resolveEnvelopeDocument(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<string | null> {
  const res = await client.query<{ document_id: string }>(
    `SELECT r.target_entity_id AS document_id
       FROM relationship r
       JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
      WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = 'envelope_of'
        AND (r.valid_to IS NULL OR r.valid_to > now())
      LIMIT 1`,
    [tenantId, envelopeId],
  )
  return res.rows[0]?.document_id ?? null
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
}

async function loadRoutingRequests(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<RoutingRequest[]> {
  const res = await client.query<{ request_id: string; ord: string; status: string }>(
    `SELECT r.source_entity_id AS request_id,
        COALESCE((SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name='signer_order'
            WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
            ORDER BY a.valid_from DESC LIMIT 1), '1') AS ord,
        COALESCE((SELECT a.value #>> '{}' FROM attribute a
            JOIN attribute_kind_definition akd ON akd.id = a.attribute_kind_id AND akd.kind_name='signer_status'
            WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
            ORDER BY a.valid_from DESC LIMIT 1), 'pending') AS status
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
  }))
}

// Deliver the lowest-order routing group that still has pending signers. Returns
// the newly-delivered request ids and whether the envelope is now fully signed.
// Pure-sequential (distinct orders) and pure-parallel (one order) both fall out
// of this: a group becomes active only once every prior group has signed.
async function deliverNextGroup(
  client: DbClient,
  tenantId: string,
  actionId: string,
  envelopeId: string,
  sourceRef: string,
): Promise<{ delivered: string[]; completed: boolean }> {
  const reqs = await loadRoutingRequests(client, tenantId, envelopeId)
  if (reqs.length === 0) return { delivered: [], completed: false }
  const unresolved = reqs.filter((r) => r.status !== 'signed' && r.status !== 'declined')
  if (unresolved.length === 0) return { delivered: [], completed: true }

  const minOrder = Math.min(...unresolved.map((r) => r.order))
  const activePending = unresolved.filter((r) => r.order === minOrder && r.status === 'pending')
  const delivered: string[] = []
  for (const r of activePending) {
    await setAttr(client, tenantId, actionId, r.requestId, 'signer_status', 'delivered', {
      sourceType: 'system',
      sourceRef,
    })
    await insertEvent(client, {
      tenantId,
      actionId,
      eventKindName: 'esign.delivered',
      primaryEntityId: envelopeId,
      secondaryEntityIds: [r.requestId],
      sourceType: 'system',
      sourceRef,
    })
    delivered.push(r.requestId)
  }
  return { delivered, completed: false }
}

// The latest NON-executed version body — the original we are executing.
async function loadOriginalBody(
  client: DbClient,
  tenantId: string,
  documentEntityId: string,
): Promise<string> {
  const res = await client.query<{ body: string }>(
    `SELECT cb.body
       FROM document_version dv
       JOIN content_blob cb ON cb.id = dv.content_blob_id
      WHERE dv.tenant_id = $1 AND dv.document_entity_id = $2
        AND (dv.metadata->>'executed') IS DISTINCT FROM 'true'
      ORDER BY dv.version_number DESC
      LIMIT 1`,
    [tenantId, documentEntityId],
  )
  return res.rows[0]?.body ?? ''
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
  const original = await loadOriginalBody(client, tenantId, documentEntityId)
  const signers = await loadEnvelopeSigners(client, tenantId, envelopeId)
  const fields = await loadEnvelopeFields(client, tenantId, envelopeId)
  const originalSha = createHash('sha256').update(original, 'utf8').digest('hex')

  // Resolve each field tag (in the body) to its signer's value.
  const signerByKey = new Map<string, FullSigner>()
  for (const s of signers) if (s.key) signerByKey.set(s.key, s)
  const valuesById: Record<string, string> = {}
  // Fields resolve in appearance order (loadEnvelopeFields preserves the parse
  // order), so "first sign field per signer" is the first tag in the document.
  const inlinedImageSigners = new Set<string>()
  for (const f of fields)
    valuesById[f.id] = fieldValue(f, signerByKey.get(f.signerKey), inlinedImageSigners)
  const filledBody = fields.length ? resolveExecutedMarkdown(original, valuesById) : original

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
