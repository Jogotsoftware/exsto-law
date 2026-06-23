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

interface DocumentUploadPayload {
  matter_entity_id: string
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
  if (!p.matter_entity_id) throw new Error('matter_entity_id is required')
  if (!p.object_key) throw new Error('object_key is required')
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

  await insertEvent(client, {
    tenantId: ctx.tenantId,
    actionId,
    eventKindName: 'document.uploaded',
    primaryEntityId: p.matter_entity_id,
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

  return { documentEntityId: docEntityId, documentVersionId: versionId, objectKey: p.object_key }
})
