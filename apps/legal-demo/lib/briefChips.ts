// PO-1 (Brief modal UX polish, product-walk 2026-07-20) — status vocabulary the
// brief engine's own checklist tables use ("Open Items Checklist" and similar)
// mapped to color-coded li-badge-style chips. Pure + exported so the
// classification is unit-testable without rendering the modal.
//
// Deliberately narrow: only an EXACT match (case-insensitive) against a known
// status word, or a "Gap" prefix (the model writes "Gap — missing X" with a
// variable tail), gets a chip. Anything else — free-text cell content — passes
// through unchanged, never guessed at. No engine/prompt change backs this: the
// vocabulary is inferred from real brief output, not asserted as a contract,
// so an unmapped status word degrades to plain table text, not a blank chip.
export type BriefChipTone = 'ok' | 'warn' | 'danger' | 'neutral'

const RULES: Array<{ test: RegExp; tone: BriefChipTone }> = [
  { test: /^complete$/i, tone: 'ok' },
  { test: /^on file$/i, tone: 'ok' },
  { test: /^pending$/i, tone: 'warn' },
  { test: /^not on file$/i, tone: 'danger' },
  { test: /^gap\b/i, tone: 'danger' },
  { test: /^unknown$/i, tone: 'neutral' },
]

export function briefStatusChipTone(cellText: string): BriefChipTone | null {
  const t = cellText.trim()
  if (!t) return null
  for (const rule of RULES) {
    if (rule.test.test(t)) return rule.tone
  }
  return null
}

// renderMarkdown's `tdWrap` hook: wraps recognized status text in a chip span,
// leaves everything else exactly as inline-formatted (including markdown
// emphasis/links inside the cell — the chip only wraps content that matched
// the RAW cell text against the vocabulary above).
export function wrapBriefStatusChip(cellText: string, cellHtml: string): string {
  const tone = briefStatusChipTone(cellText)
  return tone ? `<span class="li-brief-chip li-brief-chip--${tone}">${cellHtml}</span>` : cellHtml
}
