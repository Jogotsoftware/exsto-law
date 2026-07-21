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
import { renderDraftPdf, draftWatermarkText } from '../render/draftPdf.js'

export interface AttachmentRef {
  kind: 'draft' | 'upload'
  // The document_version id (a draft version, or an uploaded-file version).
  id: string
}

export interface AttachableDocuments {
  uploads: UploadedDocItem[]
  drafts: PendingDraftSummary[]
}

// A draft whose latest version is rejected / revision_requested is not a
// deliverable: the attorney pulled it back, so it must not be offered as an
// email attachment (and resolveMatterAttachments refuses it authoritatively).
// listMatterDraftVersions itself stays status-agnostic — the assistant's matter
// context legitimately surfaces these with their status.
const UNDELIVERABLE_DRAFT_STATUSES = new Set(['rejected', 'revision_requested'])

// The documents attachable for a matter — uploaded files (document_of) and the
// latest version of each generated draft (draft_of), excluding drafts pulled back
// for revision. Metadata only (no bytes); the picker shows these and the chosen ids
// are resolved server-side at send time.
export async function attachableDocuments(
  ctx: ActionContext,
  matterEntityId: string,
): Promise<AttachableDocuments> {
  // Only an attorney authorized to send on the matter may enumerate its documents
  // (the picker is a send affordance) — matches the send guard, no metadata leak.
  await assertCanSendOnMatter(ctx, matterEntityId)
  const [uploads, drafts] = await Promise.all([
    listMatterDocuments(ctx, matterEntityId),
    listMatterDraftVersions(ctx, matterEntityId),
  ])
  return { uploads, drafts: drafts.filter((d) => !UNDELIVERABLE_DRAFT_STATUSES.has(d.status)) }
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

// Resource caps: bound the count and total RAW bytes so a legitimately-authorized
// but pathological request (e.g. 50 same-matter uploads, or a 25 MB file) can't OOM
// the function. The total tracks raw bytes; the Gmail send guard (~18 MB) is the
// final ceiling, but we short-circuit BEFORE fetching/rendering the rest.
const MAX_ATTACHMENTS = 10
const MAX_TOTAL_RAW_BYTES = 18 * 1024 * 1024

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
  if (input.refs.length > MAX_ATTACHMENTS) {
    throw new Error(`Too many attachments (max ${MAX_ATTACHMENTS}).`)
  }
  // Defense in depth: the sender must be authorized to send on this matter. (The
  // send path checks recipient↔matter separately; this guards the doc side.)
  await assertCanSendOnMatter(ctx, input.matterEntityId)

  const out: EmailAttachment[] = []
  let totalRaw = 0
  const overBudget = () => {
    if (totalRaw > MAX_TOTAL_RAW_BYTES) {
      throw new Error('Attachments are too large to email (about 18 MB total).')
    }
  }

  for (const ref of input.refs) {
    if (ref.kind === 'draft') {
      const draft = await getDraftVersion(ctx, ref.id)
      if (!draft || draft.matterEntityId !== input.matterEntityId) {
        throw new Error('Attachment is not a draft of this matter.')
      }
      // A draft the attorney has rejected or sent back for revision is not a
      // deliverable — it must never reach the client by email. The picker omits
      // these (attachableDocuments), but this is the authoritative guard: a stale
      // ref captured before the rejection is refused here too.
      if (UNDELIVERABLE_DRAFT_STATUSES.has(draft.status)) {
        throw new Error(
          'This draft was pulled back for revision and can’t be emailed to the client.',
        )
      }
      // renderDraftPdf caps its source markdown; name the draft if it still fails so
      // one bad draft doesn't opaquely fail the whole send. A not-yet-approved
      // version carries the draft watermark (P13 — render state, never body text).
      let pdf: Buffer
      try {
        pdf = await renderDraftPdf(draft.bodyMarkdown, {
          title: humanizeKind(draft.documentKind),
          watermark: draftWatermarkText(draft.status),
          // EDITOR-FIX-1 (item 7): the per-document base font flows into the
          // emailed PDF, matching what the attorney set in the editor.
          fontFamily: draft.fontFamily ?? undefined,
          fontSize: draft.fontSize ?? undefined,
        })
      } catch (e) {
        throw new Error(
          `Could not render the "${humanizeKind(draft.documentKind)}" draft to PDF: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }
      totalRaw += pdf.length
      overBudget()
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
      // Reject by RECORDED size before fetching the bytes (uploads can be up to
      // 25 MB; the email cap is ~18 MB).
      totalRaw += obj.sizeBytes
      overBudget()
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
