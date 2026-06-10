import { registerActionHandler } from '@exsto/substrate'
import {
  getLatestAttributeValue,
  insertAttribute,
  insertContentBlob,
  insertDocumentVersion,
  insertEntity,
  insertRelationship,
  lookupKindId,
} from './common.js'

interface DraftGeneratePayload {
  matter_entity_id: string
  document_kind: 'operating_agreement' | 'engagement_letter'
  document_markdown: string
  model_identity: string
  reasoning_trace_id: string
  jurisdiction: string
}

registerActionHandler('legal.draft.generate', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as DraftGeneratePayload

  const contentBlobId = await insertContentBlob(client, {
    tenantId: ctx.tenantId,
    actionId,
    contentType: 'text/markdown',
    body: parsed.document_markdown,
  })

  const docEntityKind =
    parsed.document_kind === 'engagement_letter' ? 'engagement_letter' : 'draft_document'
  const docKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    docEntityKind,
  )
  const draftEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    docKindId,
    `${parsed.document_kind} draft for matter ${parsed.matter_entity_id}`,
    { document_kind: parsed.document_kind, jurisdiction: parsed.jurisdiction },
  )

  const docKindAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'document_kind',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: draftEntityId,
    attributeKindId: docKindAttrId,
    value: parsed.document_kind,
    confidence: 1.0,
    sourceType: 'agent',
    sourceRef: parsed.model_identity,
  })

  const docStatusAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'document_status',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: draftEntityId,
    attributeKindId: docStatusAttrId,
    value: 'pending_review',
    confidence: 1.0,
    sourceType: 'agent',
    sourceRef: parsed.model_identity,
  })

  const jurisdictionAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'document_jurisdiction',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: draftEntityId,
    attributeKindId: jurisdictionAttrId,
    value: parsed.jurisdiction,
    confidence: 1.0,
    sourceType: 'agent',
    sourceRef: parsed.model_identity,
  })

  // Compute next version number for this document.
  const versionRes = await client.query<{ max: number | null }>(
    `SELECT max(version_number) AS max FROM document_version
     WHERE tenant_id = $1 AND document_entity_id = $2`,
    [ctx.tenantId, draftEntityId],
  )
  const nextVersion = (versionRes.rows[0]?.max ?? 0) + 1

  const versionId = await insertDocumentVersion(client, {
    tenantId: ctx.tenantId,
    actionId,
    documentEntityId: draftEntityId,
    contentBlobId,
    versionNumber: nextVersion,
    status: 'pending_review',
    reasoningTraceId: parsed.reasoning_trace_id,
    metadata: { model_identity: parsed.model_identity },
  })

  const matterDocRelKindId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'matter_has_document',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: parsed.matter_entity_id,
    targetEntityId: draftEntityId,
    relationshipKindId: matterDocRelKindId,
    properties: { document_kind: parsed.document_kind },
  })

  // Advance matter status to review_pending if not already past it.
  const statusKindId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'matter_status',
  )
  const currentStatus = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    parsed.matter_entity_id,
    'matter_status',
  )
  const reviewedAlready =
    currentStatus === 'review_pending' || currentStatus === 'engagement_signed'
  if (!reviewedAlready) {
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: parsed.matter_entity_id,
      attributeKindId: statusKindId,
      value: 'review_pending',
      confidence: 1.0,
      sourceType: 'system',
      sourceRef: null,
    })
  }

  return { draftEntityId, contentBlobId, documentVersionId: versionId, versionNumber: nextVersion }
})

interface DraftReviewPayload {
  document_version_id: string
  review_notes?: string
}

async function setDocumentVersionStatus(
  client: import('@exsto/shared').DbClient,
  tenantId: string,
  versionId: string,
  status: 'approved' | 'revision_requested' | 'rejected',
): Promise<void> {
  await client.query(
    `UPDATE document_version SET status = $1
     WHERE tenant_id = $2 AND id = $3`,
    [status, tenantId, versionId],
  )
}

async function attachReviewAttribute(
  client: import('@exsto/shared').DbClient,
  tenantId: string,
  actionId: string,
  actorId: string,
  versionId: string,
  status: string,
  notes: string | undefined,
): Promise<void> {
  const versionRes = await client.query<{ document_entity_id: string }>(
    `SELECT document_entity_id FROM document_version WHERE tenant_id = $1 AND id = $2`,
    [tenantId, versionId],
  )
  const documentEntityId = versionRes.rows[0]?.document_entity_id
  if (!documentEntityId) {
    throw new Error(`document_version not found: ${versionId}`)
  }

  const docStatusAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    tenantId,
    'document_status',
  )
  await insertAttribute(client, {
    tenantId,
    actionId,
    entityId: documentEntityId,
    attributeKindId: docStatusAttrId,
    value: status,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: actorId,
  })

  if (notes) {
    const notesAttrId = await lookupKindId(
      client,
      'attribute_kind_definition',
      tenantId,
      'document_review_notes',
    )
    await insertAttribute(client, {
      tenantId,
      actionId,
      entityId: documentEntityId,
      attributeKindId: notesAttrId,
      value: notes,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: actorId,
    })
  }
}

registerActionHandler('legal.draft.approve', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as DraftReviewPayload
  await setDocumentVersionStatus(client, ctx.tenantId, parsed.document_version_id, 'approved')
  await attachReviewAttribute(
    client,
    ctx.tenantId,
    actionId,
    ctx.actorId,
    parsed.document_version_id,
    'approved',
    parsed.review_notes,
  )
  return { documentVersionId: parsed.document_version_id, status: 'approved' as const }
})

registerActionHandler('legal.draft.request_revision', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as DraftReviewPayload
  await setDocumentVersionStatus(
    client,
    ctx.tenantId,
    parsed.document_version_id,
    'revision_requested',
  )
  await attachReviewAttribute(
    client,
    ctx.tenantId,
    actionId,
    ctx.actorId,
    parsed.document_version_id,
    'revision_requested',
    parsed.review_notes,
  )
  return { documentVersionId: parsed.document_version_id, status: 'revision_requested' as const }
})

registerActionHandler('legal.draft.reject', async (ctx, client, payload, actionId) => {
  const parsed = payload as unknown as DraftReviewPayload
  await setDocumentVersionStatus(client, ctx.tenantId, parsed.document_version_id, 'rejected')
  await attachReviewAttribute(
    client,
    ctx.tenantId,
    actionId,
    ctx.actorId,
    parsed.document_version_id,
    'rejected',
    parsed.review_notes,
  )
  return { documentVersionId: parsed.document_version_id, status: 'rejected' as const }
})
