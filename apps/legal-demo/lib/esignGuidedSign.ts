// ESIGN-GUIDED-1 — pure logic for the DocuSign-style guided click-to-sign
// walk (SignDocument.tsx). Kept dependency-free (no React, no DOM) so the
// ordering/completion/progress rules are unit-testable without rendering
// anything, mirroring the esignStepFooter.test.ts pattern.
//
// A "guided field" is a placement the SIGNER acts on directly: signature,
// initials, and any signer-fillable data field (text/title/email/company/
// phone/address/check) that was NOT already resolved at send time. `date`
// and `name` placements always auto-derive from the adopted signature (never
// clicked, never counted) — see SignDocument's date/name overlay handling.
// A placement with a truthy `value` was resolved server-side (§5.3) and is
// equally inert regardless of type.
import type { FieldPlacement } from '@exsto/legal/esign'

export interface FilledContext {
  /** Signer-typed values for text-ish/check placements, keyed by placement id. */
  fieldValues: Record<string, string>
  /** Placement ids whose adopted signature/initials the signer has applied. */
  appliedIds: ReadonlySet<string>
}

/** Reading order across a (possibly multi-document) envelope: document, then
 *  page, then top-to-bottom, then left-to-right — the order ES-MULTIDOC-1
 *  requires the guided walk to honor across every document in the envelope. */
export function orderGuidedFields<
  T extends { docIndex?: number; rect: { page: number; x: number; y: number } },
>(placements: readonly T[]): T[] {
  return [...placements].sort((a, b) => {
    const da = a.docIndex ?? 0
    const db = b.docIndex ?? 0
    if (da !== db) return da - db
    if (a.rect.page !== b.rect.page) return a.rect.page - b.rect.page
    if (a.rect.y !== b.rect.y) return a.rect.y - b.rect.y
    return a.rect.x - b.rect.x
  })
}

/** True for a placement the signer interacts with directly in the guided
 *  walk — false for auto-derived (date/name) or already-resolved placements. */
export function isGuidedField(p: FieldPlacement): boolean {
  if (p.type === 'date' || p.type === 'name') return false
  if ((p.value ?? '').trim()) return false
  return true
}

/** The guided walk's field set, in reading order. */
export function guidedFieldsOf(placements: readonly FieldPlacement[]): FieldPlacement[] {
  return orderGuidedFields(placements.filter(isGuidedField))
}

/** Whether a single placement currently reads as complete. */
export function isPlacementFilled(p: FieldPlacement, ctx: FilledContext): boolean {
  if ((p.value ?? '').trim()) return true
  if (p.type === 'sign' || p.type === 'initial') return ctx.appliedIds.has(p.id)
  if (p.type === 'check') return ctx.fieldValues[p.id] === 'true'
  return Boolean((ctx.fieldValues[p.id] ?? '').trim())
}

/** The next incomplete guided field after `afterId` (wrapping around), or
 *  null once every guided field is complete. `afterId` null/undefined starts
 *  the search from the first field — this is what "Start" uses. */
export function nextIncompleteField(
  fields: readonly FieldPlacement[],
  ctx: FilledContext,
  afterId?: string | null,
): FieldPlacement | null {
  const ordered = orderGuidedFields(fields)
  if (ordered.length === 0) return null
  const startIdx = afterId ? ordered.findIndex((f) => f.id === afterId) : -1
  for (let step = 1; step <= ordered.length; step++) {
    const idx = (startIdx + step) % ordered.length
    const f = ordered[idx]!
    if (!isPlacementFilled(f, ctx)) return f
  }
  return null
}

/** Required-field progress — what the top bar's "N of M complete" reads and
 *  what gates Finish (alongside consent). */
export function guidedProgress(
  fields: readonly FieldPlacement[],
  ctx: FilledContext,
): { completed: number; total: number } {
  const required = fields.filter((f) => f.required)
  return {
    completed: required.filter((f) => isPlacementFilled(f, ctx)).length,
    total: required.length,
  }
}

export function guidedProgressLabel(progress: { completed: number; total: number }): string {
  if (progress.total === 0) return 'No required fields — ready to finish'
  return `${progress.completed} of ${progress.total} required field${progress.total === 1 ? '' : 's'} complete`
}

/** The top bar's primary CTA state machine: Start → Next → Finish. */
export function guidedCtaLabel(
  started: boolean,
  allRequiredDone: boolean,
): 'Start' | 'Next' | 'Finish' {
  if (allRequiredDone) return 'Finish'
  return started ? 'Next' : 'Start'
}
