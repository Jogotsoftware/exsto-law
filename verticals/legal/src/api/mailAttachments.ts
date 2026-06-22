// Resolve client-supplied attachment REFERENCES into actual email attachment
// bytes, enforcing the matter-scope rule. The client never sends bytes (that would
// let it attach arbitrary content / bypass scope) — it sends {kind, id} refs and
// the server resolves them:
//   • draft  — a generated draft (document_version, draft_of a matter): fetched via
//     getDraftVersion and rendered to PDF server-side (renderDraftPdf).
//   • upload — an uploaded file (document_version, document_of a matter): resolved
//     to its Storage object via getUploadedDocumentObject (the load-bearing IDOR
//     guard: it returns the object ONLY if the version is document_of THIS matter)
//     then the bytes are fetched via the injected `downloadUpload` (the service-role
//     Storage read lives in the app — apps/legal-demo/lib/documentStorage — so it is
//     passed in rather than imported, keeping the key quarantined there).
//
// SCOPE RULE (the core ask): a document may be attached only for the matter it
// belongs to. Every ref is resolved against `matterEntityId`; a draft whose
// draft_of matter differs, or an upload that is not document_of this matter, is
// rejected. The caller additionally constrains `matterEntityId` to a matter the
// RECIPIENT is a client of (replyToThread/enqueueClientEmail), so the composite
// guarantee is: doc ∈ matter ∧ recipient client_of matter ∧ sender may send on it.
import type { ActionContext } from '@exsto/substrate'
import type { EmailAttachment } from '../adapters/gmail.js'
import {
  getDraftVersion,
  listMatterDraftVersions,
  type PendingDraftSummary,
} from '../queries/drafts.js'
import {
  getUploadedDocumentObject,
  listMatterDocuments,
  type UploadedDocItem,
} from './documentUpload.js'
import { assertCanSendOnMatter } from './matterAccess.js'
import { renderDraftPdf } from '../render/draftPdf.js'

export interface AttachmentRef {
  kind: 'draft' | 'upload'
  // The document_version id (a draft version, or an uploaded-file version).
  id: string
}

export interface AttachableDocuments {
  uploads: UploadedDocItem[]
  drafts: PendingDraftSummary[]
}

// The documents attachable for a matter — uploaded files (document_of) and the
// latest version of each generated draft (draft_of). Metadata only (no bytes); the
// picker shows these and the chosen ids are resolved server-side at send time.
export async function attachableDocuments(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<AttachableDocuments> {
  const [uploads, drafts] = await Promise.all([
    listMatterDocuments(ctx, matterEntityId),
    listMatterDraftVersions(ctx, matterEntityId),
  ])
  return { uploads, drafts }
}

function humanizeKind(kind: string): string {
  return (kind || 'document').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
function slugFilename(kind: string): string {
  const base = (kind || 'document')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${base || 'document'}.pdf`
}

// Resolve attachment refs to EmailAttachment[] for ONE matter, scope-checking each.
// `downloadUpload(objectKey)` fetches an uploaded file's bytes (injected by the app).
export async function resolveMatterAttachments(
  ctx: ActionContext,
  input: {
    matterEntityId: string
    refs: AttachmentRef[]
    downloadUpload: (objectKey: string) => Promise<Buffer>
  },
): Promise<EmailAttachment[]> {
  if (!input.refs.length) return []
  // Defense in depth: the sender must be authorized to send on this matter. (The
  // send path checks recipient↔matter separately; this guards the doc side.)
  await assertCanSendOnMatter(ctx, input.matterEntityId)

  const out: EmailAttachment[] = []
  for (const ref of input.refs) {
    if (ref.kind === 'draft') {
      const draft = await getDraftVersion(ctx, ref.id)
      if (!draft || draft.matterEntityId !== input.matterEntityId) {
        throw new Error('Attachment is not a draft of this matter.')
      }
      const pdf = await renderDraftPdf(draft.bodyMarkdown, {
        title: humanizeKind(draft.documentKind),
      })
      out.push({
        filename: slugFilename(draft.documentKind),
        contentType: 'application/pdf',
        contentBase64: pdf.toString('base64'),
      })
    } else {
      const obj = await getUploadedDocumentObject(ctx, input.matterEntityId, ref.id)
      if (!obj) {
        throw new Error('Attachment is not an uploaded document of this matter.')
      }
      const bytes = await input.downloadUpload(obj.objectKey)
      out.push({
        filename: obj.filename,
        contentType: obj.contentType,
        contentBase64: bytes.toString('base64'),
      })
    }
  }
  return out
}
