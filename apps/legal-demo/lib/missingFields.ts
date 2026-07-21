// EDITOR-FIX-1 (item 4) — presentation for the deterministic merge engine's
// honest `[[MISSING: field]]` gap markers (templateMerge.ts). A template-merge
// document that lacks an intake answer carries these markers verbatim; the
// editor and reader used to show the raw `[[MISSING: dissolution_terms]]` inline.
// These helpers render them as small warn chips with a HUMANIZED field name,
// reusing the #444 unresolved-field warn tone. The underlying text stays the
// marker everywhere — this is presentation only (append-only truth).

// A fresh regex per call: the global flag carries lastIndex state, so sharing one
// instance across .replace (reader) and .exec loops (editor) would desync.
export function missingFieldRegex(): RegExp {
  return /\[\[MISSING:\s*([a-zA-Z0-9_.]+)\s*\]\]/g
}

// dissolution_terms → "Dissolution terms"; member.0.name → "Member 0 name".
export function humanizeMissingField(field: string): string {
  const words = field.replace(/[._]+/g, ' ').trim()
  if (!words) return field
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// The chip caption, e.g. "Dissolution terms — not provided at intake".
export function missingChipLabel(field: string): string {
  return `${humanizeMissingField(field)} — not provided at intake`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Reader: wrap each literal `[[MISSING: field]]` in already-sanitized document
// HTML as a warn chip. Runs AFTER renderDocumentHtml's sanitize, so the injected
// span is trusted markup — safe because a field id is [a-zA-Z0-9_.] only (no
// injection surface) and the label is HTML-escaped regardless. Scoped to the
// attorney review reader; the client share / e-sign / export surfaces render
// through renderDocumentHtml directly and are unaffected (a document with gaps
// should not be sent, not silently chip-decorated for a client).
export function renderMissingChipsHtml(html: string): string {
  return html.replace(missingFieldRegex(), (_m, field: string) => {
    const label = missingChipLabel(field)
    return `<span class="li-missing-chip" title="${escapeHtml(`Merge gap: ${field}`)}">${escapeHtml(label)}</span>`
  })
}
