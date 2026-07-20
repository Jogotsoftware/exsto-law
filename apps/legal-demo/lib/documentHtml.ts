import { Marked } from 'marked'
import sanitizeHtml from 'sanitize-html'
// Pure execution-block transform (SIG-BLOCK-1). Imported via the package's `./esign`
// subpath, NOT the '@exsto/legal' barrel: this module is client-bundled (the e-sign
// prepare/sign views are 'use client'), and the subpath resolves to a leaf pure
// module (executionBlock.ts + fields.ts) with no server dependencies.
import { renderSigMarkersForPreview } from '@exsto/legal/esign'

// Rich document renderer: markdown (with an allowlisted inline-HTML subset for
// per-run font / size / alignment) → sanitized HTML, safe to inject into a signed
// or shared document. This is the SECURITY BOUNDARY for everything a client sees
// or signs — the share page, the attorney review page, the e-sign prepare/sign
// views, and PDF/Word export all render through here. See
// verticals/legal/docs/RICH_TEMPLATE_FORMATTING.md.
//
// It deliberately differs from draftExport.renderMarkdown (which escapes ALL HTML
// and is kept for assistant-chat output): documents need the editor's font/size/
// alignment styling to survive to the finished page; chat does not.
//
// Why sanitize instead of escape: template authors apply inline styles in the
// TipTap editor, stored in the markdown body as <span style> / aligned blocks. To
// show those in the produced document we must let that subset through — but ONLY
// that subset. The allowlist below is the whole boundary: no script/style/iframe/
// img/event-handlers, and style is filtered to a fixed set of typographic
// properties with validated values (no url()/expression()/injection).

// renderer.del: a stored `~~text~~` (WP-E strikethrough) parses to <del> by
// default, but <del> is not in DOCUMENT_SANITIZE_OPTIONS.allowedTags below and
// disallowedTagsMode 'discard' means an unmapped <del> would DELETE the struck
// text entirely (not just its styling) from every surface this renders —
// review, share links, eSign, PDF/Word export. Emit the allowlisted <s> instead,
// matching templateBody.ts's editor round trip (lib/templateBody.ts).
const md = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    del(token) {
      return `<s>${this.parser.parseInline(token.tokens)}</s>`
    },
  },
})

// CSS values we accept, each validated so nothing but the intended typography
// gets through. font-family forbids ( ) : ; so url()/expression() can't appear.
const FONT_FAMILY = [/^[\w\s,'"-]+$/]
const FONT_SIZE = [/^\d+(\.\d+)?(pt|px|rem|em)$/]
const TEXT_ALIGN = [/^(left|right|center|justify)$/]
const TEXT_DECORATION = [/^(underline|line-through|none)$/]
const FONT_WEIGHT = [/^(bold|bolder|normal|[1-9]00)$/]
const FONT_STYLE = [/^(italic|normal)$/]

export const DOCUMENT_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'blockquote',
    'span',
    'div',
    'a',
  ],
  allowedAttributes: {
    '*': ['style'],
    a: ['href', 'target', 'rel'],
    span: ['style', 'class', 'data-variable'],
    div: ['style', 'class'],
  },
  allowedClasses: {
    // Classes that carry meaning in a finished document: the signature line and
    // the page break.
    div: ['sig-line', 'page-break'],
    span: ['sig-line-label'],
  },
  allowedStyles: {
    '*': {
      'font-family': FONT_FAMILY,
      'font-size': FONT_SIZE,
      'text-align': TEXT_ALIGN,
      'text-decoration': TEXT_DECORATION,
      'font-weight': FONT_WEIGHT,
      'font-style': FONT_STYLE,
    },
  },
  // Links: external http(s) + mailto only; relative in-app paths are allowed by
  // default (no scheme). A javascript:/data: href is dropped, not rendered.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  // Drop the CONTENT of anything not allowed (e.g. <script>foo</script> leaves
  // nothing), rather than surfacing its text.
  disallowedTagsMode: 'discard',
  nonTextTags: ['script', 'style', 'textarea', 'noscript', 'iframe'],
}

// Render a markdown document body (which may contain the allowlisted inline-HTML
// styling subset) to sanitized HTML for display. Tokens are expected already
// substituted by the merge engine; {{token}}/{{>include}} text that remains is
// plain text and passes through untouched (it is not HTML).
//
// Whole-line e-sign execution markers ({{sign:key}} / {{date:key}} / …) and legacy
// underscore runs are first turned into clean ruled `sig-line` markup (SIG-BLOCK-1)
// so signature/date lines render as proper lines, not literal `{{sign:client}}`
// text or broken underscores. This is DISPLAY only — the stored body keeps the
// markers, which is what the e-sign field parser (parseFields) anchors to. An
// INLINE marker inside a sentence is intentionally left verbatim.
export function renderDocumentHtml(body: string): string {
  const withSigLines = renderSigMarkersForPreview(body ?? '')
  const rendered = md.parse(withSigLines, { async: false }) as string
  return sanitizeHtml(rendered, DOCUMENT_SANITIZE_OPTIONS)
}
