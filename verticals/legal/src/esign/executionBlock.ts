// SIG-BLOCK-1 — the ONE canonical markup for signature/date/name/title execution
// blocks. Before this, drafts (and the seeded templates) ended with raw underscore
// runs — `Signature: ______` / `Date: ______` — which render as literal broken
// underscores through the markdown→react-pdf PDF pipeline and the HTML/TipTap
// preview, and give e-signature field placement nothing to anchor to.
//
// The vocabulary is the SAME anchor-tag grammar the e-sign parser already knows
// (fields.ts): `{{sign:key}}`, `{{date:key}}`, `{{name:key}}`, `{{title:key}}`,
// each carrying a signer key. This module is pure (no DB, no React, no server
// deps — only the grammar/labels from fields.ts) so it is safe to import from the
// server PDF renderer, the app's client-side HTML preview, and unit tests alike.
//
// Three surfaces, one source:
//   • buildExecutionBlock  — emit the canonical markdown block (drafting).
//   • renderSigMarkersForPreview — markers → clean ruled `sig-line` HTML (preview).
//   • classifyExecutionLine — the shared line classifier the PDF renderer reuses
//     to draw ruled lines, and which also tolerates legacy underscore runs.

import { type EsignFieldType, labelFor, MARKER_TYPE_PATTERN } from './fields.js'

// ESIGN-UNIFY-1 ES-3 — re-exported here (not just from fields.js) because this
// module is the `@exsto/legal/esign` package subpath entry (package.json
// "exports"."./esign") — the CLIENT-SAFE surface documentHtml.ts and the
// template editor bridge (apps/legal-demo/lib/templateBody.ts) import from.
// parseFields/parseMarkerLine/computeMarkerRoleDrift are pure (no DB, no
// server-only deps), so shipping them here is the same discipline as
// renderSigMarkersForPreview below.
export {
  parseFields,
  parseMarkerLine,
  computeMarkerRoleDrift,
  labelFor,
  type EsignField,
  type EsignFieldType,
  type MarkerLine,
  type EsignRoleKeyLike,
  type EsignMarkerRoleDrift,
} from './fields.js'

// ESIGN-UNIFY-1 ES-2 — the placement canvas's client-safe surface: the storage
// model + normalized-coordinate geometry (placements.ts), the anchor→rect
// bridge (markerMap.ts), and the send-time data resolver (placementData.ts).
// All pure (no DB, no pdf-lib, no server deps) — same discipline as the
// re-exports above. stampPdf.ts (pdf-lib) is deliberately NOT here: it is
// server-only and exports via the package root instead.
export {
  parseEnvelopePlacements,
  serializeEnvelopePlacements,
  isPlacementFieldType,
  PLACEMENT_FIELD_TYPES,
  DEFAULT_FIELD_POINTS,
  LETTER_POINTS,
  clamp01,
  clampRect,
  normalizeRect,
  denormalizeRect,
  defaultRectForType,
  type FieldPlacement,
  type PlacementFieldType,
  type PlacementAnchor,
  type PlacementRect,
} from './placements.js'
export { deriveMarkerMap, markerMapToPlacements, type MarkerMapEntry } from './markerMap.js'
export {
  resolvePlacementData,
  type PlacementRecipient,
  type PlacementContactFacts,
  type ResolvePlacementDataInput,
} from './placementData.js'

// A whole-line execution element is EITHER a marker line or a legacy underscore
// run, each with an OPTIONAL "Label: " prefix. Anchored to the whole (trimmed)
// line on purpose: only a line that is ENTIRELY one of these becomes a ruled line.
// An inline marker inside a sentence ("please sign {{sign:client}} below") is left
// untouched — replacing it mid-sentence with a block rule would break the prose,
// and the e-sign parser reads the stored body, not this rendering, so nothing is
// lost. The prefix char class forbids `{` `}` `<` `>` `:` so it can't swallow the
// marker's own braces or an HTML tag, and stops at the last colon before the tag.
const MARKER_LINE_RE = new RegExp(
  `^\\s*(?:([^{}<>\\n:][^{}<>\\n]*?)\\s*:\\s*)?\\{\\{\\s*(${MARKER_TYPE_PATTERN})\\s*:\\s*[A-Za-z0-9_-]+\\s*\\}\\}\\s*$`,
)
// Six or more underscores stops false positives on ordinary prose (a stray `___`).
const UNDERSCORE_LINE_RE = /^\s*(?:([^_{}<>\n:][^_{}<>\n]*?)\s*:\s*)?_{6,}\s*$/
// EDITOR-FIX-1 (item 6) — a LABELED rule line: a caption, a colon, then a run of
// underscores OR dashes (en/em dashes included), e.g. "Signature: ____",
// "Date: ------", "Print Name: ___". The label prefix is what disambiguates it
// from ordinary prose, so a run of 3 is enough here (a BARE run still needs 6 —
// UNDERSCORE_LINE_RE — and a BARE DASH run is deliberately NOT matched, so a
// markdown `---` thematic break / section separator is never swallowed). The
// caption cannot start with a rule char and forbids `{ } < > :` so it can't eat a
// marker's braces, an HTML tag, or its own label colon.
const LABELED_RULE_LINE_RE = /^\s*([^_\-{}<>\n:–—][^{}<>\n:]*?)\s*:\s*[_\-–—]{3,}\s*$/

export interface ExecutionLine {
  /** The caption shown beneath the ruled line ("Signature", "Date", …). */
  label: string
}

// Classify one physical line. Returns the ruled-line spec if the line is a whole
// execution element, else null (a normal line the caller renders as usual).
export function classifyExecutionLine(line: string): ExecutionLine | null {
  const marker = MARKER_LINE_RE.exec(line)
  if (marker) {
    const prefix = marker[1]?.trim()
    const type = marker[2] as EsignFieldType
    return { label: prefix || labelFor(type) }
  }
  const underscore = UNDERSCORE_LINE_RE.exec(line)
  if (underscore) {
    const prefix = underscore[1]?.trim()
    return { label: prefix || '' }
  }
  // A labeled underscore/dash rule line (shorter runs, or dash runs, that the
  // bare-underscore rule above intentionally skips) — the founder's "the lines
  // at the bottom … are all dashed" case renders as a clean ruled line too.
  const labeled = LABELED_RULE_LINE_RE.exec(line)
  if (labeled) {
    return { label: labeled[1]!.trim() }
  }
  return null
}

// EDITOR-FIX-1 (item 6a) — merge-time post-processing for LEGACY template bodies
// whose execution section is drawn with underscore/dash runs rather than the
// canonical markers. It splits a COMPOUND execution line — a printed name/role
// followed by an inline date/signature rule, e.g.
// `{{member_name}}, Sole Member / Date: ____` (after merge:
// `Jane Roe, Sole Member / Date: ____`) — into the name/role line and a
// standalone `Date: ____` line, so that trailing rule becomes a WHOLE-line
// execution element classifyExecutionLine renders as a clean ruled line
// everywhere. Bare runs and whole labeled runs already classify on their own, so
// they pass through untouched; a body with no compound line is returned verbatim
// (referential no-op). Pure — safe to run in the merge path and unit tests alike.
const COMPOUND_EXECUTION_TAIL_RE =
  /^(.*\S)\s+\/\s+([^_\-{}<>\n:–—][^{}<>\n:]*?\s*:\s*[_\-–—]{2,})\s*$/

export function canonicalizeExecutionLines(markdown: string): string {
  if (!markdown) return markdown
  const lines = markdown.split('\n')
  let changed = false
  const out: string[] = []
  for (const line of lines) {
    const m = COMPOUND_EXECUTION_TAIL_RE.exec(line)
    if (m) {
      changed = true
      out.push(m[1]!.trimEnd())
      out.push('')
      out.push(m[2]!.trim())
    } else {
      out.push(line)
    }
  }
  return changed ? out.join('\n') : markdown
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// The clean visual line: the SAME `sig-line` markup the TipTap editor produces and
// the document sanitizer allowlists (documentHtml.ts) — a CSS-ruled line with a
// small caption beneath. Reusing it means marker-authored and editor-authored
// signature lines render identically everywhere a document is shown.
function sigLineHtml(label: string): string {
  return `<div class="sig-line"><span class="sig-line-label">${escapeHtmlText(label)}</span></div>`
}

// Replace whole-line execution markers (and legacy underscore runs) with clean
// ruled `sig-line` HTML, for the markdown→HTML document preview. Runs BEFORE the
// markdown parser: each replaced line is isolated by blank lines so the injected
// `<div>` is a standalone HTML block (adjacent markdown keeps rendering normally).
// A document with no execution lines is returned unchanged (referential no-op).
export function renderSigMarkersForPreview(markdown: string): string {
  if (!markdown) return markdown
  const lines = markdown.split('\n')
  let changed = false
  const out = lines.map((line) => {
    const cls = classifyExecutionLine(line)
    if (!cls) return line
    changed = true
    return `\n${sigLineHtml(cls.label)}\n`
  })
  if (!changed) return markdown
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export interface ExecutionSigner {
  /** The signer key the markers carry, matching an e-sign signer (e.g. `client`). */
  key: string
  /** Printed name shown on the draft; when absent a `{{name:key}}` marker is used. */
  name?: string
  /** Title/capacity line; only emitted when provided (individuals rarely have one). */
  title?: string
}

// Build the canonical markdown execution section: an "Accepted and Agreed:" header
// (overridable) then, per signer, a signature marker, a printed-name line, an
// optional title line, and a date marker — each on its own line so it renders as a
// discrete ruled line. This is the exact shape the drafting prompt instructs the
// model to emit and the seeded engagement letter uses.
export function buildExecutionBlock(
  signers: ExecutionSigner[],
  opts?: { heading?: string },
): string {
  const heading = opts?.heading ?? 'Accepted and Agreed:'
  const blocks = signers.map((s) => {
    const lines = [`{{sign:${s.key}}}`, s.name ? `Name: **${s.name}**` : `{{name:${s.key}}}`]
    if (s.title) lines.push(`Title: ${s.title}`)
    lines.push(`{{date:${s.key}}}`)
    return lines.join('\n\n')
  })
  return [`**${heading}**`, ...blocks].join('\n\n')
}
