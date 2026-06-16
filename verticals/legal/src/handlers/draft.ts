import { registerActionHandler } from '@exsto/substrate'
import type { DbClient } from '@exsto/shared'
import {
  getLatestAttributeValue,
  insertAttribute,
  insertContentBlob,
  insertDocumentVersion,
  insertEntity,
  insertEvent,
  insertOutcome,
  insertRelationship,
  lookupKindId,
} from './common.js'

// ───────────────────────────────────────────────────────────────────────────
// draft.generate — persist an AI-generated draft (REQ-DRAFT-01..04). The
// action kind requires a reasoning trace (invariant 20); submitAction enforces
// it, the worker persists it first. Creates document_draft + content_blob +
// document_version v1 (pending_review), wires draft_of, emits draft.completed.
// ───────────────────────────────────────────────────────────────────────────

interface DraftGeneratePayload {
  matter_entity_id: string
  // Any service-configured document kind (the two Phase-0 kinds plus any added via
  // the Service Library). Stored verbatim as the document_kind attribute/label.
  document_kind: string
  document_markdown: string
  model_identity: string
  reasoning_trace_id: string
  jurisdiction: string
  confidence?: number
}

registerActionHandler('draft.generate', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftGeneratePayload

  const contentBlobId = await insertContentBlob(client, {
    tenantId: ctx.tenantId,
    actionId,
    contentType: 'text/markdown',
    body: p.document_markdown,
  })

  const docKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'document_draft',
  )
  const draftEntityId = await insertEntity(
    client,
    ctx.tenantId,
    actionId,
    docKindId,
    `${p.document_kind} draft`,
    { document_kind: p.document_kind, jurisdiction: p.jurisdiction },
  )

  const draftAttrs: Array<{ kind: string; value: unknown; confidence?: number }> = [
    { kind: 'document_kind', value: p.document_kind },
    { kind: 'draft_status', value: 'pending_review' },
    { kind: 'document_jurisdiction', value: p.jurisdiction },
  ]
  if (p.confidence != null)
    draftAttrs.push({ kind: 'drafting_confidence', value: p.confidence, confidence: p.confidence })
  for (const a of draftAttrs) {
    const akId = await lookupKindId(client, 'attribute_kind_definition', ctx.tenantId, a.kind)
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: draftEntityId,
      attributeKindId: akId,
      value: a.value,
      confidence: a.confidence ?? 1.0,
      sourceType: 'agent',
      sourceRef: p.model_identity,
    })
  }

  const versionId = await insertDocumentVersion(client, {
    tenantId: ctx.tenantId,
    actionId,
    documentEntityId: draftEntityId,
    contentBlobId,
    versionNumber: 1,
    status: 'pending_review',
    reasoningTraceId: p.reasoning_trace_id,
    metadata: { model_identity: p.model_identity },
  })

  const draftOfId = await lookupKindId(
    client,
    'relationship_kind_definition',
    ctx.tenantId,
    'draft_of',
  )
  await insertRelationship(client, {
    tenantId: ctx.tenantId,
    actionId,
    sourceEntityId: draftEntityId,
    targetEntityId: p.matter_entity_id,
    relationshipKindId: draftOfId,
    properties: { document_kind: p.document_kind },
  })

  // Matter moves to in_review once a draft lands (unless already terminal).
  const currentStatus = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    p.matter_entity_id,
    'matter_status',
  )
  if (currentStatus !== 'approved' && currentStatus !== 'closed') {
    const statusKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'matter_status',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.matter_entity_id,
      attributeKindId: statusKindId,
      value: 'in_review',
      confidence: 1.0,
      sourceType: 'system',
      sourceRef: null,
    })
  }

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'draft.completed',
    primaryEntityId: p.matter_entity_id,
    secondaryEntityIds: [draftEntityId],
    data: {
      document_kind: p.document_kind,
      document_version_id: versionId,
      model_identity: p.model_identity,
    },
    sourceType: 'agent',
    sourceRef: p.model_identity,
  })

  return { draftEntityId, contentBlobId, documentVersionId: versionId, versionNumber: 1 }
})

// ───────────────────────────────────────────────────────────────────────────
// draft.approve / draft.request_revision / draft.reject — attorney review
// decisions (REQ-REVIEW-04). Each records an OUTCOME row about the draft
// (WP1 outcome kinds) plus the status flip; all auditable, all reversible per
// the action kind's declared reversibility.
// ───────────────────────────────────────────────────────────────────────────

interface DraftReviewPayload {
  document_version_id: string
  review_notes?: string
}

async function reviewDecision(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    versionId: string
    versionStatus: 'approved' | 'revision_requested' | 'rejected'
    outcomeKind: 'draft_approved' | 'draft_revision_requested' | 'draft_rejected'
    polarity: 'positive' | 'neutral' | 'negative'
    notes?: string
  },
): Promise<{ documentEntityId: string; matterEntityId: string | null }> {
  const versionRes = await client.query<{ document_entity_id: string }>(
    `SELECT document_entity_id FROM document_version WHERE tenant_id = $1 AND id = $2`,
    [args.tenantId, args.versionId],
  )
  const documentEntityId = versionRes.rows[0]?.document_entity_id
  if (!documentEntityId) throw new Error(`document_version not found: ${args.versionId}`)

  await client.query(`UPDATE document_version SET status = $1 WHERE tenant_id = $2 AND id = $3`, [
    args.versionStatus,
    args.tenantId,
    args.versionId,
  ])

  const statusAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    args.tenantId,
    'draft_status',
  )
  await insertAttribute(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    entityId: documentEntityId,
    attributeKindId: statusAttrId,
    value: args.versionStatus,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: args.actorId,
  })

  if (args.notes) {
    const notesAttrId = await lookupKindId(
      client,
      'attribute_kind_definition',
      args.tenantId,
      'document_review_notes',
    )
    await insertAttribute(client, {
      tenantId: args.tenantId,
      actionId: args.actionId,
      entityId: documentEntityId,
      attributeKindId: notesAttrId,
      value: args.notes,
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: args.actorId,
    })
  }

  await insertOutcome(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    outcomeKindName: args.outcomeKind,
    subjectEntityId: documentEntityId,
    polarity: args.polarity,
    data: { document_version_id: args.versionId, notes: args.notes ?? null },
    sourceType: 'human',
    sourceRef: args.actorId,
  })

  // Find the matter for status propagation (draft_of: draft → matter).
  const matterRes = await client.query<{ matter_id: string }>(
    `SELECT r.target_entity_id AS matter_id FROM relationship r
     JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
     WHERE r.tenant_id = $1 AND r.source_entity_id = $2 AND rkd.kind_name = 'draft_of'
     LIMIT 1`,
    [args.tenantId, documentEntityId],
  )
  return { documentEntityId, matterEntityId: matterRes.rows[0]?.matter_id ?? null }
}

registerActionHandler('draft.approve', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftReviewPayload
  const { documentEntityId, matterEntityId } = await reviewDecision(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    versionId: p.document_version_id,
    versionStatus: 'approved',
    outcomeKind: 'draft_approved',
    polarity: 'positive',
    notes: p.review_notes,
  })
  if (matterEntityId) {
    const statusKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'matter_status',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: matterEntityId,
      attributeKindId: statusKindId,
      value: 'approved',
      confidence: 1.0,
      sourceType: 'human',
      sourceRef: ctx.actorId,
    })
  }
  return {
    documentVersionId: p.document_version_id,
    documentEntityId,
    status: 'approved' as const,
  }
})

registerActionHandler('draft.request_revision', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftReviewPayload
  const { documentEntityId } = await reviewDecision(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    versionId: p.document_version_id,
    versionStatus: 'revision_requested',
    outcomeKind: 'draft_revision_requested',
    polarity: 'neutral',
    notes: p.review_notes,
  })
  return {
    documentVersionId: p.document_version_id,
    documentEntityId,
    status: 'revision_requested' as const,
  }
})

registerActionHandler('draft.reject', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftReviewPayload
  const { documentEntityId } = await reviewDecision(client, {
    tenantId: ctx.tenantId,
    actionId,
    actorId: ctx.actorId,
    versionId: p.document_version_id,
    versionStatus: 'rejected',
    outcomeKind: 'draft_rejected',
    polarity: 'negative',
    notes: p.review_notes,
  })
  return {
    documentVersionId: p.document_version_id,
    documentEntityId,
    status: 'rejected' as const,
  }
})

// ───────────────────────────────────────────────────────────────────────────
// document.edit — inline attorney edit producing a NEW document_version row
// (REQ-REVIEW-05, invariant 14: never destructive overwrites).
// ───────────────────────────────────────────────────────────────────────────

interface DocumentEditPayload {
  document_version_id: string // the version being edited
  document_markdown: string
  note?: string
}

registerActionHandler('document.edit', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DocumentEditPayload

  const baseRes = await client.query<{
    document_entity_id: string
    version_number: number
    status: string
  }>(
    `SELECT document_entity_id, version_number, status
     FROM document_version WHERE tenant_id = $1 AND id = $2`,
    [ctx.tenantId, p.document_version_id],
  )
  const base = baseRes.rows[0]
  if (!base) throw new Error(`document_version not found: ${p.document_version_id}`)

  const contentBlobId = await insertContentBlob(client, {
    tenantId: ctx.tenantId,
    actionId,
    contentType: 'text/markdown',
    body: p.document_markdown,
  })

  const maxRes = await client.query<{ max: number | null }>(
    `SELECT max(version_number) AS max FROM document_version
     WHERE tenant_id = $1 AND document_entity_id = $2`,
    [ctx.tenantId, base.document_entity_id],
  )
  const nextVersion = (maxRes.rows[0]?.max ?? 0) + 1

  const versionId = await insertDocumentVersion(client, {
    tenantId: ctx.tenantId,
    actionId,
    documentEntityId: base.document_entity_id,
    contentBlobId,
    versionNumber: nextVersion,
    status: base.status === 'approved' ? 'approved' : 'pending_review',
    reasoningTraceId: null,
    metadata: {
      edited_from_version_id: p.document_version_id,
      editor_actor_id: ctx.actorId,
      note: p.note ?? null,
    },
  })

  return {
    documentEntityId: base.document_entity_id,
    documentVersionId: versionId,
    versionNumber: nextVersion,
  }
})
