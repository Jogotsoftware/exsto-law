// document.upload — record an attorney-uploaded file as a first-class substrate
// document. The bytes are ALREADY in Supabase Storage (placed by the upload
// route); this handler records the document the substrate way: a content_blob
// whose `body` is the STORAGE OBJECT KEY (with the real file's MIME/size/sha256),
// a document_uploaded entity + document_source attribute, a document_version
// (status 'approved' — not an AI draft to review), a `document_of` relationship
// to the matter (DISTINCT from draft_of so uploads never pollute the draft lane),
// and a document.uploaded event. All inside the action's transaction (hard rule 1).
import { registerActionHandler } from '@exsto/substrate'
import {
  insertAttribute,
  insertContentBlob,
  insertDocumentVersion,
  insertEntity,
  insertEvent,
  insertRelationship,
  lookupKindId,
} from './common.js'
import { dispatchClientDelivery } from './clientDelivery.js'

interface DocumentUploadPayload {
  // OPTIONAL since 0170: a standalone upload (the e-sign "any PDF" path) has no
  // matter. It may instead be filed under a contact via attach_contact_entity_id,
  // or stand fully alone (reachable through its envelope).
  matter_entity_id?: string | null
  // File the upload under an existing client_contact (document_of_contact, 0170).
  // Independent of client_contact_id below, which is upload PROVENANCE.
  attach_contact_entity_id?: string | null
  // The storage object key (the route already uploaded the bytes under it).
  object_key: string
  original_filename: string
  // Server-sniffed MIME (never the browser-supplied type).
  content_type: string
  size_bytes: number
  // sha256 of the file BYTES, hex.
  sha256_hex: string
  document_kind?: string
  // 'uploaded' (firm) | 'client_uploaded' (portal client). Drives provenance.
  document_source?: string
  // The uploading client_contact, when document_source = 'client_uploaded'.
  client_contact_id?: string | null
}

registerActionHandler('document.upload', async (ctx, client, payload, actionId) => {
  const p = payload as unknown as DocumentUploadPayload
  if (!p.object_key) throw new Error('object_key is required')
  // Client (portal) uploads are always matter-scoped — only the firm's e-sign
  // path may record a standalone document.
  if (!p.matter_entity_id && p.document_source === 'client_uploaded') {
    throw new Error('matter_entity_id is required for a client upload')
  }
  const filename = (p.original_filename ?? '').trim() || 'document'
  const documentKind = (p.document_kind ?? '').trim() || 'uploaded'

  // Provenance (ADR 0035): a client upload is attributed to the client_contact, not
  // the firm actor, so history honestly shows the client provided the file. The firm
  // upload keeps the actor as source_ref. The action's actor is the system actor
  // either way (the portal route runs as the public-intake actor).
  const isClientUpload = p.document_source === 'client_uploaded' && !!p.client_contact_id
  const docSource = isClientUpload ? 'client_uploaded' : 'uploaded'
  const provenanceRef = isClientUpload ? `client_contact:${p.client_contact_id}` : ctx.actorId
  const uploadedBy = isClientUpload ? { uploaded_by_client_contact_id: p.client_contact_id } : {}

  // content_blob.body = the storage object key (a pointer); the hash + size
  // describe the real file bytes, passed explicitly.
  const contentBlobId = await insertContentBlob(client, {
    tenantId: ctx.tenantId,
    actionId,
    contentType: p.content_type,
    body: p.object_key,
    sha256: Buffer.from(p.sha256_hex, 'hex'),
    sizeBytes: p.size_bytes,
  })

  const entityKindId = await lookupKindId(
    client,
    'entity_kind_definition',
    ctx.tenantId,
    'document_uploaded',
  )
  const docEntityId = await insertEntity(client, ctx.tenantId, actionId, entityKindId, filename, {
    document_kind: documentKind,
    document_class: 'uploaded',
    document_source: docSource,
    original_filename: filename,
    content_type: p.content_type,
    ...uploadedBy,
  })

  const sourceAttrId = await lookupKindId(
    client,
    'attribute_kind_definition',
    ctx.tenantId,
    'document_source',
  )
  await insertAttribute(client, {
    tenantId: ctx.tenantId,
    actionId,
    entityId: docEntityId,
    attributeKindId: sourceAttrId,
    value: docSource,
    confidence: 1.0,
    sourceType: 'human',
    sourceRef: provenanceRef,
  })

  const versionId = await insertDocumentVersion(client, {
    tenantId: ctx.tenantId,
    actionId,
    documentEntityId: docEntityId,
    contentBlobId,
    versionNumber: 1,
    status: 'approved',
    reasoningTraceId: null,
    metadata: {
      document_source: docSource,
      storage_bucket: 'matter-documents',
      object_key: p.object_key,
      content_type: p.content_type,
      size_bytes: p.size_bytes,
      original_filename: filename,
      document_kind: documentKind,
      ...uploadedBy,
    },
  })

  if (p.matter_entity_id) {
    const documentOfId = await lookupKindId(
      client,
      'relationship_kind_definition',
      ctx.tenantId,
      'document_of',
    )
    await insertRelationship(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceEntityId: docEntityId,
      targetEntityId: p.matter_entity_id,
      relationshipKindId: documentOfId,
      properties: { document_kind: documentKind, document_source: docSource },
    })
  }

  if (p.attach_contact_entity_id) {
    const documentOfContactId = await lookupKindId(
      client,
      'relationship_kind_definition',
      ctx.tenantId,
      'document_of_contact',
    )
    await insertRelationship(client, {
      tenantId: ctx.tenantId,
      actionId,
      sourceEntityId: docEntityId,
      targetEntityId: p.attach_contact_entity_id,
      relationshipKindId: documentOfContactId,
      properties: { document_kind: documentKind, document_source: docSource },
    })
  }

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'document.uploaded',
    primaryEntityId: p.matter_entity_id ?? docEntityId,
    secondaryEntityIds: [docEntityId],
    data: {
      document_version_id: versionId,
      object_key: p.object_key,
      content_type: p.content_type,
      size_bytes: p.size_bytes,
      original_filename: filename,
      document_kind: documentKind,
      document_source: docSource,
      ...uploadedBy,
    },
    sourceType: 'human',
    sourceRef: provenanceRef,
  })

  // ADR 0046 — a CLIENT upload is a delivery: it advances a matter parked at a client
  // gate whose edge is `via: 'document.upload'` (e.g. "client sends the follow-up
  // materials"). Firm uploads never drive a client gate, so only client uploads
  // dispatch. Flag-guarded no-op otherwise.
  if (isClientUpload && p.matter_entity_id) {
    await dispatchClientDelivery(
      client,
      ctx,
      p.matter_entity_id,
      'document.upload',
      actionId,
      provenanceRef,
    )
  }

  return { documentEntityId: docEntityId, documentVersionId: versionId, objectKey: p.object_key }
})
