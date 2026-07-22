// ENGAGEMENT-DOC-1 — app-layer orchestration for the executed engagement copy.
// When a client accepts the engagement agreement in the portal gate, this renders
// the merged agreement to PDF, stamps their typed signature + acceptance date at
// the {{sign:client}}/{{date:client}} lines, stores the executed PDF, and records
// it as a document filed under the contact (downloadable later).
//
// Storage bytes + PDF rendering live in the app layer (the vertical never touches
// Storage — CI vertical-storage-guard); the vertical builds the plan
// (buildEngagementExecutedPlan) and records the resulting document
// (recordUploadedDocument). Mirrors the e-sign executed-copy split
// (lib/esignStamping.ts).
import { createHash } from 'node:crypto'
import type { ActionContext } from '@exsto/substrate'
import {
  buildEngagementExecutedPlan,
  recordUploadedDocument,
  renderDraftPdf,
  stampExecutedPdf,
  ENGAGEMENT_DOC_KIND,
} from '@exsto/legal'
import { uploadObject } from '@/lib/documentStorage'

// Best-effort by design: the caller runs this AFTER the acceptance event is
// already recorded, so a failure here must never turn a successful signing into
// an error — the caller catches and logs.
export async function generateAndStoreEngagementExecutedCopy(
  ctx: ActionContext,
  clientContactId: string,
  input: { signerName: string; signedAtIso: string },
): Promise<{ stored: boolean }> {
  const plan = await buildEngagementExecutedPlan(ctx, clientContactId, input)
  if (!plan) return { stored: false }

  // The signature is already written INTO the markdown (in-flow, placement-exact —
  // see buildEngagementExecutedPlan); stampExecutedPdf runs with no coordinate
  // fields, solely to append the signature-certificate page.
  const basePdf = await renderDraftPdf(plan.markdown, { title: plan.title })
  const executed = Buffer.from(
    await stampExecutedPdf({
      pdfBytes: basePdf,
      fields: [],
      certificate: plan.certificate,
    }),
  )
  const sha256Hex = createHash('sha256').update(executed).digest('hex')
  // Content-addressed key: a re-acceptance (distinct timestamp → distinct
  // certificate → distinct bytes) always lands a fresh key; an identical replay
  // is idempotent.
  const objectKey = `engagement-agreements/${ctx.tenantId}/${clientContactId}/${sha256Hex}.executed.pdf`
  await uploadObject(objectKey, executed, 'application/pdf')

  await recordUploadedDocument(ctx, {
    objectKey,
    originalFilename: plan.filename,
    contentType: 'application/pdf',
    sizeBytes: executed.length,
    sha256Hex,
    attachContactEntityId: clientContactId,
    documentSource: 'uploaded',
    documentKind: ENGAGEMENT_DOC_KIND,
  })
  return { stored: true }
}
