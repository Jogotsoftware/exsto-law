// ENGAGEMENT-DOC-1 — the executed (signed) copy of the engagement agreement.
// When a client accepts in the portal gate, they adopt a typed signature on the
// merged agreement; this module produces the SUBSTRATE side of turning that into
// a durable, downloadable executed PDF:
//
//   buildEngagementExecutedPlan  — WHAT to render + stamp (pure/substrate: the
//     merged markdown + the sign/date stamp fields from the marker map + a
//     signature certificate). No Storage, no PDF bytes — the app layer owns those
//     (CI vertical-storage-guard), exactly like the e-sign executed-copy split.
//   getEngagementExecutedCopyRef — resolve the stored executed PDF for a contact
//     (document_of_contact + document_kind 'engagement_agreement'), for the
//     download routes. Newest first.
//
// The engagement gate is firm-level and PRE-matter, so the executed copy files
// under the CONTACT (document_of_contact, matterless — the same 0170 lane the
// e-sign "any PDF" path uses), never a matter.
import { withActionContext, type ActionContext } from '@exsto/substrate'
import { getClientEngagementAgreement } from './engagementAgreement.js'
import { getContact } from '../queries/contacts.js'
import { longDate } from './templateMerge.js'
import type { FileCertInput } from '../esign/fileCertificate.js'

export const ENGAGEMENT_DOC_KIND = 'engagement_agreement'

export interface EngagementExecutedPlan {
  /** The agreement markdown with the client's signature + date substituted IN —
   *  rendered to PDF by the app layer. */
  markdown: string
  title: string
  filename: string
  certificate: FileCertInput
}

// The client's typed signature is written INTO the markdown at the {{sign:client}}
// / {{date:client}} markers before rendering — NOT stamped at coordinates. Reason:
// deriveMarkerMap (the coordinate route the e-sign flow uses) is a deterministic
// APPROXIMATION of react-pdf's pagination that the e-sign flow corrects with a
// manual placement-nudge step; the engagement gate has no nudge, so a blind
// coordinate stamp lands on the wrong page of a long letter. In-flow substitution
// is placement-exact by construction. `/s/` is the standard conformed-signature
// notation for an electronic signature.
export function substituteClientSignature(
  markdown: string,
  signerName: string,
  signedAtIso: string,
): string {
  return markdown
    .replace(/\{\{\s*(?:sign|initial)\s*:\s*client\s*\}\}/gi, `/s/ ${signerName}`)
    .replace(/\{\{\s*date\s*:\s*client\s*\}\}/gi, longDate(signedAtIso))
}

// Build the executed-copy plan for THIS client's acceptance. Returns null when the
// firm has no engagement-agreement template (nothing to execute) or the contact
// can't be resolved.
export async function buildEngagementExecutedPlan(
  ctx: ActionContext,
  clientContactId: string,
  input: { signerName: string; signedAtIso: string },
): Promise<EngagementExecutedPlan | null> {
  const signerName = input.signerName.trim()
  if (!signerName) return null
  const [agreement, contact] = await Promise.all([
    getClientEngagementAgreement(ctx, clientContactId),
    getContact(ctx, clientContactId),
  ])
  if (!agreement || !contact) return null

  const markdown = substituteClientSignature(agreement.markdown, signerName, input.signedAtIso)

  const certificate: FileCertInput = {
    // No e-sign envelope backs the gate acceptance — a synthetic id keeps the
    // certificate's "envelope" line meaningful and unique per contact.
    envelopeId: `engagement:${clientContactId}`,
    filename: `${agreement.templateId}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: null,
    sha256Hex: null,
    signers: [
      {
        name: signerName,
        email: contact.email || null,
        title: agreement.signerLabel,
        signed_at: input.signedAtIso,
        consent:
          'Adopted electronically in the client portal by accepting the engagement agreement.',
      },
    ],
  }

  const who = contact.companyName?.trim() || contact.fullName?.trim() || 'Client'
  return {
    markdown,
    title: 'Engagement Agreement',
    filename: `Engagement Agreement — ${who}.pdf`,
    certificate,
  }
}

export interface EngagementExecutedCopyRef {
  documentVersionId: string
  objectKey: string
  filename: string
  contentType: string
  sizeBytes: number
}

// Resolve the latest stored executed engagement copy for a contact — a document
// filed UNDER the contact (document_of_contact) with document_kind
// 'engagement_agreement'. Tenant-scoped through RLS; a foreign contact resolves
// to null. Object key is server-side only (returned here for the download route,
// never to a list).
export async function getEngagementExecutedCopyRef(
  ctx: ActionContext,
  clientContactId: string,
): Promise<EngagementExecutedCopyRef | null> {
  return withActionContext(ctx, async (client) => {
    const res = await client.query<{
      version_id: string
      object_key: string | null
      original_filename: string | null
      content_type: string | null
      size_bytes: string | null
    }>(
      `SELECT dv.id AS version_id,
              dv.metadata->>'object_key'        AS object_key,
              dv.metadata->>'original_filename' AS original_filename,
              dv.metadata->>'content_type'      AS content_type,
              dv.metadata->>'size_bytes'        AS size_bytes
         FROM document_version dv
         JOIN relationship r ON r.source_entity_id = dv.document_entity_id
         JOIN relationship_kind_definition rkd ON rkd.id = r.relationship_kind_id
        WHERE dv.tenant_id = $1
          AND rkd.kind_name = 'document_of_contact'
          AND r.target_entity_id = $2
          AND dv.metadata->>'document_kind' = $3
          AND (r.valid_to IS NULL OR r.valid_to > now())
        ORDER BY dv.recorded_at DESC
        LIMIT 1`,
      [ctx.tenantId, clientContactId, ENGAGEMENT_DOC_KIND],
    )
    const row = res.rows[0]
    if (!row?.object_key) return null
    return {
      documentVersionId: row.version_id,
      objectKey: row.object_key,
      filename: row.original_filename ?? 'Engagement Agreement.pdf',
      contentType: row.content_type ?? 'application/pdf',
      sizeBytes: row.size_bytes ? Number(row.size_bytes) : 0,
    }
  })
}
