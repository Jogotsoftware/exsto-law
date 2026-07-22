// BILINGUAL-DOCS-1 — a Spanish document copy is a separate document whose
// document_kind is the English kind + '_es' (that suffix is its identity, see
// verticals/legal documentLanguage.ts). For DISPLAY, strip the suffix and append
// a clear "(Spanish)" tag so an attorney/client sees "Operating Agreement
// (Spanish)" instead of the raw "operating agreement es". English kinds render
// exactly as before.
export function documentKindLabel(kind: string): string {
  const isEs = kind.endsWith('_es')
  const base = isEs ? kind.slice(0, -'_es'.length) : kind
  const humanized = base.replace(/_/g, ' ')
  return isEs ? `${humanized} (Spanish)` : humanized
}

export function isSpanishDocumentKind(kind: string): boolean {
  return kind.endsWith('_es')
}
