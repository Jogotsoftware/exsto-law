// E-signature action handlers (Session 5). All writes flow through these
// handlers under submitAction (vertical CLAUDE.md). Provider-agnostic: nothing
// here names a provider — it is an attribute value.
//
//   esign.send          → create signature_envelope (+ one signature_request per
//                         signer), link envelope_of → document, emit esign.sent.
//   esign.sign          → NATIVE: a signer adopts their signature; the last
//                         signer completes the envelope and the executed copy
//                         (original + signature certificate, with the original
//                         content SHA-256) is written as a NEW immutable
//                         document_version (invariant 14). esign.signed/completed.
//   esign.decline       → NATIVE: a signer declines; envelope closes. esign.declined.
//   esign.record_status → EXTERNAL (dormant): record a verified provider callback,
//                         same transitions, for a future external driver.
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

interface SendSigner {
  email: string
  name?: string | null
  signer_provider_ref?: string | null
}

interface EsignSendPayload {
  document_entity_id: string
  document_version_id: string
  matter_entity_id?: string | null
  provider: string
  // Set by the API only when the provider actually dispatched (live host present).
  provider_envelope_ref?: string | null
  dispatched: boolean
  correlation_id: string
  subject: string
  signers: SendSigner[]
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
  // provider_envelope_ref only exists once a live provider dispatched the envelope.
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

  // envelope_of: the envelope executes this document.
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

  // One signature_request per signer, each linked request_of → envelope.
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
  for (const signer of p.signers) {
    const requestId = await insertEntity(
      client,
      tenantId,
      actionId,
      requestKindId,
      signer.name ?? signer.email,
      { email: signer.email },
    )
    await setAttr(client, tenantId, actionId, requestId, 'signer_email', signer.email, {
      sourceRef: ctx.actorId,
    })
    if (signer.name) {
      await setAttr(client, tenantId, actionId, requestId, 'signer_name', signer.name, {
        sourceRef: ctx.actorId,
      })
    }
    await setAttr(client, tenantId, actionId, requestId, 'signer_status', 'pending', {
      sourceRef: ctx.actorId,
    })
    if (signer.signer_provider_ref) {
      await setAttr(
        client,
        tenantId,
        actionId,
        requestId,
        'signer_provider_ref',
        signer.signer_provider_ref,
        { sourceType: 'integration', sourceRef: `integration:${p.provider}` },
      )
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
      provider_envelope_ref: p.provider_envelope_ref ?? null,
      document_entity_id: p.document_entity_id,
      document_version_id: p.document_version_id,
      signer_count: requestIds.length,
      correlation_id: p.correlation_id,
    },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  return { envelopeId, requestIds, status: envelopeStatus, dispatched: p.dispatched }
})

interface EsignRecordStatusPayload {
  envelope_entity_id: string
  provider_envelope_ref?: string | null
  status: 'signed' | 'completed' | 'declined'
  signer_email?: string | null
  // Executed copy bytes, present on completion.
  executed_document?: { content_type: string; body: string } | null
  raw_event_log_id?: string | null
  // Provenance for the callback, e.g. 'integration:opensign'.
  source_ref?: string | null
}

registerActionHandler('esign.record_status', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignRecordStatusPayload
  const tenantId = ctx.tenantId
  const sourceRef = p.source_ref ?? 'integration:esign'

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)
  const documentEntityId = await resolveEnvelopeDocument(client, tenantId, p.envelope_entity_id)

  // Flip the named signer's status when the callback identifies one.
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
      data: {
        signer_email: p.signer_email ?? null,
        provider_envelope_ref: p.provider_envelope_ref ?? null,
      },
      sourceType: 'integration',
      sourceRef,
    })
    return { envelopeId: p.envelope_entity_id, status: 'declined' as const }
  }

  // status === 'completed': close the envelope and write the executed copy as a
  // NEW immutable document_version (invariant 14 — never overwrite in place).
  await setAttr(client, tenantId, actionId, p.envelope_entity_id, 'envelope_status', 'completed', {
    sourceType: 'integration',
    sourceRef,
  })

  let executedVersionId: string | null = null
  let executedVersionNumber: number | null = null
  if (p.executed_document && documentEntityId) {
    const contentBlobId = await insertContentBlob(client, {
      tenantId,
      actionId,
      contentType: p.executed_document.content_type || 'application/pdf',
      body: p.executed_document.body,
    })
    executedVersionNumber = (await maxVersionNumber(client, tenantId, documentEntityId)) + 1
    executedVersionId = await insertDocumentVersion(client, {
      tenantId,
      actionId,
      documentEntityId,
      contentBlobId,
      versionNumber: executedVersionNumber,
      // The executed copy is the final, approved artifact.
      status: 'approved',
      reasoningTraceId: null,
      metadata: {
        executed: true,
        executed_from_envelope_id: p.envelope_entity_id,
        provider_envelope_ref: p.provider_envelope_ref ?? null,
        source: 'esign',
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
      executed_document_version_id: executedVersionId,
      executed_version_number: executedVersionNumber,
    },
    sourceType: 'integration',
    sourceRef,
  })

  return {
    envelopeId: p.envelope_entity_id,
    status: 'completed' as const,
    executedDocumentVersionId: executedVersionId,
    executedVersionNumber,
  }
})

// ───────────────────────────────────────────────────────────────────────────
// esign.sign — NATIVE path. A signer adopts their signature on their request.
// On the last outstanding signer the envelope completes: the executed copy
// (original document + a signature certificate, with the original content's
// SHA-256 as tamper-evidence) is written as a NEW immutable document_version
// (invariant 14). Recorded as the public-intake system actor; signer identity
// lives on the signature_request, not on an actor (like the client portal).
// ───────────────────────────────────────────────────────────────────────────

interface EsignSignPayload {
  request_entity_id: string
  envelope_entity_id: string
  signature_name: string // the signer's typed/adopted name
  signature_data?: string | null // optional drawn-signature image data URL
  consent_text: string // the intent-to-sign statement accepted (ESIGN/UETA)
  signed_at?: string | null
}

registerActionHandler('esign.sign', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as EsignSignPayload
  const tenantId = ctx.tenantId
  const signedAt = p.signed_at ?? new Date().toISOString()
  const sourceRef = `signature_request:${p.request_entity_id}`

  await assertEnvelopeExists(client, tenantId, p.envelope_entity_id)

  // Record the signature on this signer's request.
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

  await insertEvent(client, {
    tenantId,
    actionId,
    eventKindName: 'esign.signed',
    primaryEntityId: p.envelope_entity_id,
    secondaryEntityIds: [p.request_entity_id],
    data: { signature_name: p.signature_name, signed_at: signedAt },
    sourceType: 'human',
    sourceRef,
  })

  // Last signer? Complete the envelope and write the executed copy.
  const { total, signed } = await countSignerStatuses(client, tenantId, p.envelope_entity_id)
  if (total > 0 && signed >= total) {
    await setAttr(
      client,
      tenantId,
      actionId,
      p.envelope_entity_id,
      'envelope_status',
      'completed',
      {
        sourceType: 'system',
        sourceRef,
      },
    )
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
    return {
      envelopeId: p.envelope_entity_id,
      status: 'completed' as const,
      completed: true,
      executedDocumentVersionId: executedVersionId,
      executedVersionNumber,
    }
  }

  return { envelopeId: p.envelope_entity_id, status: 'signed' as const, completed: false }
})

// ───────────────────────────────────────────────────────────────────────────
// esign.decline — NATIVE path. A signer declines; the envelope closes declined.
// ───────────────────────────────────────────────────────────────────────────

interface EsignDeclinePayload {
  request_entity_id: string
  envelope_entity_id: string
  reason?: string | null
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
    data: { reason: p.reason ?? null },
    sourceType: 'human',
    sourceRef,
  })
  return { envelopeId: p.envelope_entity_id, status: 'declined' as const }
})

// ── helpers ──────────────────────────────────────────────────────────────────

// Append a new attribute value (temporality: latest-by-valid_from wins, as the
// draft handlers do). Provenance defaults to a human firm write; callbacks pass
// sourceType 'integration'.
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

// envelope_of: envelope (source) → document (target).
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

// The signature_request (signer slot) for an email within this envelope.
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

// How many of the envelope's signers have signed (latest signer_status per
// request), and how many requests there are in total.
async function countSignerStatuses(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<{ total: number; signed: number }> {
  const res = await client.query<{ total: number; signed: number }>(
    `WITH reqs AS (
       SELECT r.source_entity_id AS request_id
       FROM relationship r
       JOIN relationship_kind_definition rkd
         ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
       WHERE r.tenant_id = $1 AND r.target_entity_id = $2
         AND (r.valid_to IS NULL OR r.valid_to > now())
     ),
     latest AS (
       SELECT DISTINCT ON (a.entity_id) a.entity_id, a.value #>> '{}' AS status
       FROM attribute a
       JOIN attribute_kind_definition akd
         ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_status'
       WHERE a.tenant_id = $1 AND a.entity_id IN (SELECT request_id FROM reqs)
       ORDER BY a.entity_id, a.valid_from DESC
     )
     SELECT count(*)::int AS total,
            count(*) FILTER (WHERE l.status = 'signed')::int AS signed
     FROM reqs r LEFT JOIN latest l ON l.entity_id = r.request_id`,
    [tenantId, envelopeId],
  )
  return { total: res.rows[0]?.total ?? 0, signed: res.rows[0]?.signed ?? 0 }
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

interface CertSigner {
  name: string | null
  email: string | null
  signed_at: string | null
  consent: string | null
}

async function loadEnvelopeSigners(
  client: DbClient,
  tenantId: string,
  envelopeId: string,
): Promise<CertSigner[]> {
  const res = await client.query<CertSigner>(
    `SELECT
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_name'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1) AS name,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_email'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1) AS email,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signed_at'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1) AS signed_at,
       (SELECT a.value #>> '{}' FROM attribute a JOIN attribute_kind_definition akd
          ON akd.id = a.attribute_kind_id AND akd.kind_name = 'signer_consent'
          WHERE a.entity_id = r.source_entity_id AND a.tenant_id = $1
          ORDER BY a.valid_from DESC LIMIT 1) AS consent
     FROM relationship r
     JOIN relationship_kind_definition rkd
       ON rkd.id = r.relationship_kind_id AND rkd.kind_name = 'request_of'
     WHERE r.tenant_id = $1 AND r.target_entity_id = $2
       AND (r.valid_to IS NULL OR r.valid_to > now())
     ORDER BY r.recorded_at`,
    [tenantId, envelopeId],
  )
  return res.rows
}

// Build + persist the executed copy as a new immutable document_version: the
// original markdown + a signature certificate, with the original content's
// SHA-256 embedded so any later tampering is detectable.
async function writeExecutedVersion(
  client: DbClient,
  tenantId: string,
  actionId: string,
  envelopeId: string,
  documentEntityId: string,
): Promise<{ versionId: string; versionNumber: number }> {
  const original = await loadOriginalBody(client, tenantId, documentEntityId)
  const signers = await loadEnvelopeSigners(client, tenantId, envelopeId)
  const originalSha = createHash('sha256').update(original, 'utf8').digest('hex')

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
        `- **${sgn.name ?? sgn.email ?? 'Signer'}** (${sgn.email ?? '—'}) — signed ${
          sgn.signed_at ?? '—'
        }\n  Consent: "${sgn.consent ?? '—'}"`,
    ),
    '',
    `**Original content SHA-256:** \`${originalSha}\``,
    `**Envelope:** \`${envelopeId}\``,
    '',
  ].join('\n')

  const executedMarkdown = `${original}${cert}`
  const contentBlobId = await insertContentBlob(client, {
    tenantId,
    actionId,
    contentType: 'text/markdown',
    body: executedMarkdown,
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
      signers: signers.map((sgn) => ({
        name: sgn.name,
        email: sgn.email,
        signed_at: sgn.signed_at,
      })),
    },
  })
  return { versionId, versionNumber }
}
