import TurndownService from 'turndown'
import { Marked } from 'marked'
import { parseMarkerLine, labelFor, type EsignFieldType } from '@exsto/legal/esign'

// Client-side markdown ⇆ HTML conversion for the rich template editor.
//
// Templates are STORED as markdown (the deterministic merge engine and the
// drafting pipeline operate on `{{token}}` markdown — Contract H). TipTap edits
// HTML, so we convert at the page boundary only: markdown → HTML to seed the
// editor, HTML → markdown to save. Storage and every server path stay markdown.
//
// This is the CLIENT-side bridge (never imports server vertical code). It mirrors
// verticals/legal/src/templates/bodyConversion.ts in intent, but is authoritative
// for the editor round-trip and deliberately disables turndown's escaping (see
// below) — keep them aligned if the server bridge ever enters the live path.

// A private marked instance so we never mutate global marked options app-wide.
// renderer.del: marked's GFM strikethrough (`~~text~~`) parses to <del> by
// default, but TipTap's Strike mark (WP-E toolbar) only recognizes <s> on the
// way back in (see the strike turndown rule below) — override so the round trip
// is lossless instead of silently dropping struck text back to plain text.
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    del(token) {
      return `<s>${this.parser.parseInline(token.tokens)}</s>`
    },
  },
})

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
})

// Disable turndown's character escaping. By default it backslash-escapes every
// `_`, `*`, `[`, etc. in text — which corrupts our merge syntax ({{>nda_clause}}
// → {{>nda\_clause}}, breaking the include key) and any literal underscore in
// prose (form_1099 → form\_1099). Structural markdown (#, **bold**, - lists) comes
// from turndown's ELEMENT rules, not from escaping, so turning escaping off keeps
// formatting intact while preserving text — and tokens — verbatim.
turndown.escape = (s: string) => s

// TipTap renders a template variable as <span data-variable="name">{{name}}</span>.
// Collapse it back to {{name}} so the saved body is plain markdown.
turndown.addRule('templateVariableSpan', {
  filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-variable'),
  replacement: (_content, node) =>
    `{{${(node as HTMLElement).getAttribute('data-variable') ?? ''}}}`,
})

// ESIGN-UNIFY-1 ES-3 (15.16b): a marker-carrying signature line (data-sig-type
// + data-sig-key, inserted by the eSign panel or hydrated from a stored marker
// line) converts BACK to its {{type:key}} marker line — the markers are the
// storage; the ruled line is only the display. A label that matches the type's
// default ("Signature", "Date", …) emits the bare marker; a custom label emits
// the `Label: {{type:key}}` prefix form the parser (classifyExecutionLine /
// parseMarkerLine) round-trips. Label-only sig-lines fall through to keep().
turndown.addRule('sigMarkerLine', {
  filter: (node) =>
    node.nodeName === 'DIV' &&
    (node as HTMLElement).classList?.contains('sig-line') &&
    !!(node as HTMLElement).getAttribute('data-sig-type') &&
    !!(node as HTMLElement).getAttribute('data-sig-key'),
  replacement: (_content, node) => {
    const el = node as HTMLElement
    const type = el.getAttribute('data-sig-type') ?? ''
    const key = el.getAttribute('data-sig-key') ?? ''
    const label = el.querySelector('.sig-line-label')?.textContent?.trim() ?? ''
    const marker = `{{${type}:${key}}}`
    const isDefault = !label || label === labelFor(type as EsignFieldType)
    return `\n\n${isDefault ? marker : `${label}: ${marker}`}\n\n`
  },
})

// Rich typography must survive the save (markdown can't express per-run font /
// size / alignment, so we KEEP the allowlisted inline-HTML the editor produces as
// raw HTML in the markdown body — the document renderer sanitizes it on the way
// out, see documentHtml.ts). Without this, turndown would flatten a styled span to
// plain text and an aligned heading to a bare `#`, silently dropping the styling.
// span[style] / underline / signature-line have NO built-in turndown rule, so a
// keep() (lowest priority) cleanly preserves them as raw HTML.
turndown.keep((node) => {
  const el = node as HTMLElement
  // Per-run font / size / decoration (token chips carry data-variable, not style,
  // so they keep their own rule above and are never matched here).
  if (el.nodeName === 'SPAN' && el.getAttribute('style')) return true
  // Underline has no markdown equivalent.
  if (el.nodeName === 'U') return true
  // The signature-line block.
  if (el.nodeName === 'DIV' && el.classList?.contains('sig-line')) return true
  // The page-break block.
  if (el.nodeName === 'DIV' && el.classList?.contains('page-break')) return true
  return false
})

// Strikethrough (WP-E toolbar) has no built-in turndown rule (that's only in the
// separate turndown-plugin-gfm, not a dependency here) — without one, an <s> mark
// would fall through to turndown's generic unknown-inline handling and silently
// lose its strike styling on save. GFM `~~text~~` is what markdownToHtml's
// renderer.del override above expects back. A filter function (not the string-
// array shorthand) because 'strike' is a deprecated tag absent from TypeScript's
// HTMLElementTagNameMap — the shorthand's type won't accept it.
const STRIKE_TAGS = new Set(['S', 'STRIKE', 'DEL'])
turndown.addRule('strike', {
  filter: (node) => STRIKE_TAGS.has(node.nodeName),
  replacement: (content) => `~~${content}~~`,
})

// Alignment lives on block elements that DO have built-in commonmark rules
// (heading → `#`, paragraph → text), which out-prioritize keep(). So an aligned
// block needs an addRule (user rules win) that emits it as raw HTML; an unaligned
// block doesn't match the filter and falls through to its normal markdown rule.
const ALIGNED_BLOCKS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'BLOCKQUOTE'])
turndown.addRule('alignedBlock', {
  filter: (node) =>
    ALIGNED_BLOCKS.has(node.nodeName) &&
    /text-align\s*:/i.test((node as HTMLElement).getAttribute?.('style') ?? ''),
  replacement: (_content, node) => `\n\n${(node as HTMLElement).outerHTML}\n\n`,
})

// A bare merge token: {{client_name}}. Deliberately NOT matched: {{>include_key}}
// and {{type:signer}} e-sign tags carry `>`/`:` (outside [a-zA-Z0-9_]), so they
// stay as plain text and are never turned into editable chips.
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html ?? '')
}

// ES-3: whole-line {{type:key}} markers (with an optional "Label:" prefix)
// hydrate as ruled sig-line nodes carrying the marker in data attributes, so
// the attorney sees the ruled line, never the raw marker (15.16b). Runs BEFORE
// the markdown parser; each div is isolated by blank lines so it parses as a
// standalone HTML block. Inline markers mid-sentence are left as text (same
// whole-line rule as renderSigMarkersForPreview).
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function hydrateMarkerLines(body: string): string {
  if (!body || !body.includes('{{')) return body
  const lines = body.split('\n')
  let changed = false
  const out = lines.map((line) => {
    const m = parseMarkerLine(line)
    if (!m) return line
    changed = true
    return `\n<div class="sig-line" data-sig-type="${escapeAttr(m.type)}" data-sig-key="${escapeAttr(m.signerKey)}"><span class="sig-line-label">${escapeAttr(m.label)}</span></div>\n`
  })
  if (!changed) return body
  return out.join('\n').replace(/\n{3,}/g, '\n\n')
}

export function markdownToHtml(body: string): string {
  const html = md.parse(hydrateMarkerLines(body ?? ''), { async: false }) as string
  // Re-hydrate {{token}} markers into TipTap variable spans so they load as
  // atomic chips (not editable literal text). The turndown rule above reverses this.
  return html.replace(
    TOKEN_RE,
    (_m, name: string) => `<span data-variable="${name}">{{${name}}}</span>`,
  )
}
