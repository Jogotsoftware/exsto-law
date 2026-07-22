// esign-executed-copy-complete — shared executed-copy stamping step for EVERY
// route that can complete an envelope. Extracted from the token /api/sign/
// submit route (the only place this used to run) so the client-portal MCP
// route (legal.esign.portal.sign) can run the SAME stamping loop — before
// this fix, a portal-completed envelope never got its `.executed.pdf`, and
// every byte route that "serves the executed copy when present" silently fell
// back to the unsigned original (root cause of the bug this file fixes).
//
// Storage bytes live ONLY in the app layer (this file) — the vertical never
// touches Storage (CI vertical-storage-guard, tests/invariants/
// vertical-storage-guard.test.ts). `@exsto/legal`'s loadExecutedStampPlan(By
// Token) resolves WHAT to stamp (substrate-only); this module does the
// downloading/stamping/uploading.
import { stampExecutedPdf, type ExecutedStampPlan } from '@exsto/legal'
import { downloadObject, uploadObject } from '@/lib/documentStorage'

export interface StampedExecutedCopy {
  plan: ExecutedStampPlan
  bytes: Buffer
}

/**
 * Stamp the executed copy of every placement-carrying PDF document in an
 * envelope's stamping plan (ES-2 §5.4) and persist it beside the original
 * (`<objectKey>.executed.pdf`). Best-effort PER DOCUMENT: a stamping failure
 * must never turn a successful signing into an error, so failures are logged
 * and that one document is skipped rather than thrown. Returns the stamped
 * bytes already in memory (keyed to their plan) so a completion-email caller
 * (sendEnvelopeCompletionCopies) can attach them without a second Storage
 * round trip.
 */
export async function stampExecutedCopies(
  plans: ExecutedStampPlan[],
): Promise<StampedExecutedCopy[]> {
  const stamped: StampedExecutedCopy[] = []
  for (const plan of plans) {
    try {
      const original = await downloadObject(plan.objectKey)
      const bytes = Buffer.from(
        await stampExecutedPdf({
          pdfBytes: original,
          fields: plan.fields,
          certificate: plan.certificate,
        }),
      )
      await uploadObject(plan.executedObjectKey, bytes, 'application/pdf')
      stamped.push({ plan, bytes })
    } catch (stampErr) {
      console.error('esign executed-copy stamping failed:', stampErr)
    }
  }
  return stamped
}

/** Convenience: the stamped bytes, keyed by ExecutedStampPlan.docIndex — the
 *  shape sendEnvelopeCompletionCopies wants for its `fileBytesByDocIndex`. */
export function stampedBytesByDocIndex(stamped: StampedExecutedCopy[]): Map<number, Buffer> {
  return new Map(stamped.map((s) => [s.plan.docIndex, s.bytes]))
}
