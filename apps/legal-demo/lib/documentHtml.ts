import { Marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

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

const md = new Marked({ gfm: true, breaks: true })

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
    // The only class that carries meaning in a document is the signature line.
    div: ['sig-line'],
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
// substituted by the merge engine; {{token}}/{{>include}}/{{type:key}} text that
// remains is plain text and passes through untouched (it is not HTML).
export function renderDocumentHtml(body: string): string {
  const rendered = md.parse(body ?? '', { async: false }) as string
  return sanitizeHtml(rendered, DOCUMENT_SANITIZE_OPTIONS)
}
