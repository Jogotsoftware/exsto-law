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
import { workflowEngineEnabled } from '../lifecycle/flags.js'
import { getWorkflowInstanceForMatter, resolveBoundWorkflowById } from '../lifecycle/binding.js'
import { advanceWorkflowInstance } from '../lifecycle/instance.js'
import { allowedTransitions, stageByKey } from '../lifecycle/resolve.js'
import { scheduleProducingAutoRun } from '../lifecycle/autoRun.js'

// ───────────────────────────────────────────────────────────────────────────
// draft.generate / draft.merge — persist a first-draft document (REQ-DRAFT-01..04,
// WP3.4). Two production paths share one persistence shape:
//   • draft.generate — AI draft. requires_reasoning_trace=true; the worker
//     persists the trace first, then submits with it. Provenance: the model.
//   • draft.merge    — deterministic template merge (Objective 6). No model call,
//     so no reasoning trace. Provenance: system. Same document_draft + version.
// Both create content_blob + document_draft entity + document_version v1
// (pending_review), wire draft_of, flip the matter to in_review, emit
// draft.completed, and record generation_mode so the audit trail names the METHOD.
// ───────────────────────────────────────────────────────────────────────────

// VERSION-metadata vocabulary (what method produced this document). 'ai_review'
// exists ONLY here — the SERVICE-level generation-mode config stays binary
// (ai_draft | template_merge); its parsers coerce unknown values, so the review
// marker must never travel through that channel.
type GenerationMode = 'ai_draft' | 'template_merge' | 'ai_review'

interface PersistDraftArgs {
  matterEntityId: string
  // Any service-configured document kind. Stored verbatim as the document_kind
  // attribute/label.
  documentKind: string
  documentMarkdown: string
  jurisdiction: string
  generationMode: GenerationMode
  // Set for ai_draft (the trace is mandatory there); null for template_merge.
  reasoningTraceId: string | null
  // Provenance of the produced facts: 'agent' (the model) for ai_draft,
  // 'system' (deterministic render) for template_merge.
  sourceType: 'agent' | 'system'
  // The model identity for ai_draft; the merge method label for template_merge.
  sourceRef: string
  confidence?: number
  versionMetadata?: Record<string, unknown>
}

async function persistDraftDocument(
  ctx: { tenantId: string; actorId: string },
  client: DbClient,
  actionId: string,
  p: PersistDraftArgs,
): Promise<{
  draftEntityId: string
  contentBlobId: string
  documentVersionId: string
  versionNumber: number
}> {
  const contentBlobId = await insertContentBlob(client, {
    tenantId: ctx.tenantId,
    actionId,
    contentType: 'text/markdown',
    body: p.documentMarkdown,
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
    `${p.documentKind} draft`,
    { document_kind: p.documentKind, jurisdiction: p.jurisdiction },
  )

  const draftAttrs: Array<{ kind: string; value: unknown; confidence?: number }> = [
    { kind: 'document_kind', value: p.documentKind },
    { kind: 'draft_status', value: 'pending_review' },
    { kind: 'document_jurisdiction', value: p.jurisdiction },
    { kind: 'generation_mode', value: p.generationMode },
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
      sourceType: p.sourceType,
      sourceRef: p.sourceRef,
    })
  }

  const versionId = await insertDocumentVersion(client, {
    tenantId: ctx.tenantId,
    actionId,
    documentEntityId: draftEntityId,
    contentBlobId,
    versionNumber: 1,
    status: 'pending_review',
    reasoningTraceId: p.reasoningTraceId,
    metadata: { generation_mode: p.generationMode, ...(p.versionMetadata ?? {}) },
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
    targetEntityId: p.matterEntityId,
    relationshipKindId: draftOfId,
    properties: { document_kind: p.documentKind },
  })

  // An AI review MEMO is an internal attorney artifact, NOT a client
  // deliverable. It must not touch the client-visible matter workflow: no
  // 'in_review' status flip (the matter keeps its real status) and no
  // 'draft.completed' milestone (which the client portal renders as the
  // misleading "A document is ready" with nothing released). Its audit trail is
  // the separate document.review.completed event runDocumentReview records.
  const isReviewMemo = p.generationMode === 'ai_review'

  // Matter moves to in_review once a draft lands (unless already terminal).
  const currentStatus = await getLatestAttributeValue<string>(
    client,
    ctx.tenantId,
    p.matterEntityId,
    'matter_status',
  )
  if (!isReviewMemo && currentStatus !== 'approved' && currentStatus !== 'closed') {
    const statusKindId = await lookupKindId(
      client,
      'attribute_kind_definition',
      ctx.tenantId,
      'matter_status',
    )
    await insertAttribute(client, {
      tenantId: ctx.tenantId,
      actionId,
      entityId: p.matterEntityId,
      attributeKindId: statusKindId,
      value: 'in_review',
      confidence: 1.0,
      sourceType: 'system',
      sourceRef: null,
    })
  }

  if (!isReviewMemo) {
    await insertEvent(client, {
      tenantId: ctx.tenantId,
      actionId,
      eventKindName: 'draft.completed',
      primaryEntityId: p.matterEntityId,
      secondaryEntityIds: [draftEntityId],
      data: {
        document_kind: p.documentKind,
        document_version_id: versionId,
        generation_mode: p.generationMode,
        model_identity: p.generationMode === 'ai_draft' ? p.sourceRef : null,
      },
      sourceType: p.sourceType,
      sourceRef: p.sourceRef,
    })
  }

  return { draftEntityId, contentBlobId, documentVersionId: versionId, versionNumber: 1 }
}

interface DraftGeneratePayload {
  matter_entity_id: string
  document_kind: string
  document_markdown: string
  model_identity: string
  reasoning_trace_id: string
  jurisdiction: string
  confidence?: number
  // AI document review (reviewDocument.ts): the memo is persisted through this
  // same action so it lands in the review queue unchanged. 'ai_review' is the
  // only accepted override — anything else stays 'ai_draft'.
  generation_mode?: string
  review_of_document_version_id?: string
  review_of_document_entity_id?: string
  review_original_filename?: string
  // Extracted source text + optional redline ride the memo VERSION as extra
  // content blobs (linked by id in versionMetadata) — deliberately NOT a second
  // draft entity, which would double the queue rows per reviewed document.
  review_source_text?: string | null
  review_redline_text?: string | null
  redline_reasoning_trace_id?: string | null
}

registerActionHandler('draft.generate', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftGeneratePayload
  const isReview = p.generation_mode === 'ai_review'

  let versionMetadata: Record<string, unknown> | undefined
  if (isReview) {
    const sourceBlobId = p.review_source_text
      ? await insertContentBlob(client, {
          tenantId: ctx.tenantId,
          actionId,
          contentType: 'text/plain',
          body: p.review_source_text,
        })
      : null
    const redlineBlobId = p.review_redline_text
      ? await insertContentBlob(client, {
          tenantId: ctx.tenantId,
          actionId,
          contentType: 'text/markdown',
          body: p.review_redline_text,
        })
      : null
    versionMetadata = {
      review_of_document_version_id: p.review_of_document_version_id ?? null,
      review_of_document_entity_id: p.review_of_document_entity_id ?? null,
      review_original_filename: p.review_original_filename ?? null,
      review_source_blob_id: sourceBlobId,
      review_redline_blob_id: redlineBlobId,
      redline_reasoning_trace_id: p.redline_reasoning_trace_id ?? null,
    }
  }

  return persistDraftDocument(ctx, client, actionId, {
    matterEntityId: p.matter_entity_id,
    documentKind: p.document_kind,
    documentMarkdown: p.document_markdown,
    jurisdiction: p.jurisdiction,
    generationMode: isReview ? 'ai_review' : 'ai_draft',
    reasoningTraceId: p.reasoning_trace_id,
    sourceType: 'agent',
    sourceRef: p.model_identity,
    confidence: p.confidence,
    versionMetadata,
  })
})

interface DraftMergePayload {
  matter_entity_id: string
  document_kind: string
  document_markdown: string
  jurisdiction: string
  // The template the merge rendered (config version vs bundled repo), for audit.
  template_id?: string
  // Slots left unfilled by the deterministic merge — surfaced to the attorney.
  missing_fields?: string[]
}

registerActionHandler('draft.merge', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DraftMergePayload
  return persistDraftDocument(ctx, client, actionId, {
    matterEntityId: p.matter_entity_id,
    documentKind: p.document_kind,
    documentMarkdown: p.document_markdown,
    jurisdiction: p.jurisdiction,
    generationMode: 'template_merge',
    reasoningTraceId: null,
    sourceType: 'system',
    sourceRef: 'template_merge',
    versionMetadata: {
      template_id: p.template_id ?? null,
      missing_fields: p.missing_fields ?? [],
    },
  })
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

// ADR 0045 — keep the workflow_instance in lock-step with the matter_status mirror
// on the attorney-gated 'draft.approve' edge. draft.approve writes matter_status
// directly (above); without this the instance's current_state would diverge from the
// status. signalEvent is for system/automatic gates ONLY, so it must NOT be used
// here — instead we advance the instance the SAME way handlers/workflow.ts does for a
// gated edge, but we do NOT re-mirror matter_status (the caller already wrote it) and
// we emit workflow.advanced exactly once. Flag-guarded no-op; a no-op too when the
// matter has no instance, is already in the target state, or has no draft.approve
// edge from its current stage (e.g. a service whose lifecycle approves differently).
async function advanceInstanceOnApprove(
  client: DbClient,
  ctx: { tenantId: string; actorId: string },
  matterEntityId: string,
  actionId: string,
): Promise<void> {
  if (!workflowEngineEnabled()) return
  const instance = await getWorkflowInstanceForMatter(client, ctx.tenantId, matterEntityId)
  if (!instance) return

  const from = instance.currentState
  // Resolve the bound graph (a per-instance override supersedes the version).
  let graph =
    instance.statesOverride && instance.statesOverride.length > 0 ? instance.statesOverride : []
  if (graph.length === 0) {
    const bound = await resolveBoundWorkflowById(
      client,
      ctx.tenantId,
      instance.workflowDefinitionId,
    )
    graph = bound?.graph ?? []
  }
  if (graph.length === 0) return

  // Only the attorney 'draft.approve' edge out of the current stage. If the instance
  // is already past it (idempotent re-approve) there is no such edge → no-op.
  const edge = allowedTransitions(graph, from, ['attorney']).find((e) => e.via === 'draft.approve')
  if (!edge) return

  const toStage = stageByKey(graph, edge.to)
  await advanceWorkflowInstance(client, ctx, {
    instanceId: instance.id,
    fromState: from,
    toState: edge.to,
    gate: 'attorney',
    via: 'draft.approve',
    status: toStage?.terminal ? 'completed' : undefined,
    actionId,
  })

  // Status coherence (ADR 0046): draft.approve unconditionally mirrored
  // matter_status = 'approved' for the classic single-document service (whose
  // approve edge lands on the stage keyed 'approved'). In a MULTI-STAGE flow (e.g.
  // an invoke_capability(ai_document_review) whose approve advances to a later
  // stage such as 'materials_requested'), that hardcode would desync the status
  // from the instance's real state. When the instance advanced somewhere other than
  // 'approved', re-mirror the status to the true next stage (append-only; last write
  // wins). NC_SMLLC's edge.to === 'approved' → this is a no-op there.
  if (edge.to !== 'approved') {
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
      value: edge.to,
      confidence: 1.0,
      knowabilityState: 'observed',
      timePrecision: 'exact_instant',
      sourceType: 'system',
      sourceRef: null,
    })
  }

  // The audit event for the advance.
  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'workflow.advanced',
    primaryEntityId: matterEntityId,
    data: { from, to: edge.to, gate: 'attorney', trigger: 'draft.approve' },
    sourceType: 'human',
    sourceRef: ctx.actorId,
  })

  // ADR 0046 — approving a review memo may land the matter on the NEXT
  // invoke_capability stage (e.g. request client materials); run it post-commit.
  scheduleProducingAutoRun(ctx, matterEntityId, edge.to, graph)
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
    // Advance the running workflow instance in lock-step (flag-guarded no-op).
    await advanceInstanceOnApprove(client, ctx, matterEntityId, actionId)
    await accrueDocumentFeeOnApproval(client, {
      tenantId: ctx.tenantId,
      actionId,
      actorId: ctx.actorId,
      matterEntityId,
      documentEntityId,
    })
  }
  return {
    documentVersionId: p.document_version_id,
    documentEntityId,
    status: 'approved' as const,
  }
})

// Beta billing: when a document is APPROVED, its flat DOCUMENT fee (if the service
// configures one for that document kind) accrues as a billable item — a
// document_fee.recorded event on the matter, which shows in the Unbilled list and
// invoices like time/expenses. A matter can produce several documents, so several
// document fees. Idempotent per (matter, document_kind): one fee per kind per
// matter, even if the document is re-approved or has multiple versions. The fee is
// read from the service config's transitions.document_fees[document_kind]. (The
// SERVICE-completion fee — transitions.cost type 'fixed' — accrues separately, when
// the service is marked complete; see handlers/fee.ts.)
async function accrueDocumentFeeOnApproval(
  client: DbClient,
  args: {
    tenantId: string
    actionId: string
    actorId: string
    matterEntityId: string
    documentEntityId: string
  },
): Promise<void> {
  const documentKind = await getLatestAttributeValue<string>(
    client,
    args.tenantId,
    args.documentEntityId,
    'document_kind',
  )
  if (!documentKind) return

  const already = await client.query<{ found: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM event e
       JOIN event_kind_definition ekd ON ekd.id = e.event_kind_id
       WHERE e.tenant_id = $1 AND e.primary_entity_id = $2
         AND ekd.kind_name = 'document_fee.recorded'
         AND e.payload->>'document_kind' = $3
     ) AS found`,
    [args.tenantId, args.matterEntityId, documentKind],
  )
  if (already.rows[0]?.found) return

  const serviceKey = await getLatestAttributeValue<string>(
    client,
    args.tenantId,
    args.matterEntityId,
    'service_key',
  )
  if (!serviceKey) return

  const feeRes = await client.query<{
    document_fees: Record<string, string> | null
  }>(
    `SELECT transitions->'document_fees' AS document_fees
       FROM workflow_definition
      WHERE tenant_id = $1 AND kind_name = $2 AND valid_to IS NULL
      ORDER BY version DESC LIMIT 1`,
    [args.tenantId, serviceKey],
  )
  const fees = feeRes.rows[0]?.document_fees ?? null
  const amount = fees && typeof fees === 'object' ? fees[documentKind] : null
  if (!amount || !String(amount).trim()) return

  await insertEvent(client, {
    tenantId: args.tenantId,
    actionId: args.actionId,
    eventKindName: 'document_fee.recorded',
    primaryEntityId: args.matterEntityId,
    secondaryEntityIds: [args.documentEntityId],
    sourceType: 'system',
    sourceRef: args.actorId,
    data: {
      service_key: serviceKey,
      document_kind: documentKind,
      amount: String(amount),
      description: `Document fee — ${documentKind.replace(/_/g, ' ')}`,
    },
  })
}

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
