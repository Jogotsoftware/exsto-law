// BILINGUAL-DOCS-1 — the one place the "what languages does the client want their
// documents in" concept is defined, so the funnel (which captures the answer),
// the approval hook (which reads it), and the document-kind identity scheme all
// agree on the same strings.
//
// The choice is captured as a top-level intake answer under DOCUMENT_LANGUAGE_FIELD_ID
// with a MACHINE value ('en' | 'both') — not a display label — so gating never
// depends on localized copy. The funnel only shows the choice when the service's
// offer_spanish flag is on; a service that isn't bilingual never records it, and
// an absent answer means English only.

export const DOCUMENT_LANGUAGE_FIELD_ID = 'document_language'

export type DocumentLanguageChoice = 'en' | 'both'

export function intakeWantsBilingual(
  responses: Record<string, unknown> | null | undefined,
): boolean {
  return responses?.[DOCUMENT_LANGUAGE_FIELD_ID] === 'both'
}

// A Spanish document is a SEPARATE document whose identity (document_kind) is the
// English kind + this suffix. document_kind is the only dimension the drafting
// idempotency guard, the regenerate supersede lookup, and every listing query key
// on, so the suffix is what keeps the Spanish copy from colliding with / superseding
// its English source.
export const SPANISH_DOC_KIND_SUFFIX = '_es'

export function spanishDocumentKind(englishKind: string): string {
  return `${englishKind}${SPANISH_DOC_KIND_SUFFIX}`
}

export function isSpanishDocumentKind(kind: string): boolean {
  return kind.endsWith(SPANISH_DOC_KIND_SUFFIX)
}

export function baseDocumentKind(kind: string): string {
  return isSpanishDocumentKind(kind) ? kind.slice(0, -SPANISH_DOC_KIND_SUFFIX.length) : kind
}
