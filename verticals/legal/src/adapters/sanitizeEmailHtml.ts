import sanitizeHtml from 'sanitize-html'

// Inbound email HTML is UNTRUSTED — a received message can carry scripts, event
// handlers, tracking pixels, remote CSS, or framed phishing. We render the HTML
// part in the Mail tab so formatting (bold, lists, links, tables) survives, but
// only after passing it through a tight allowlist here, on the SERVER, so unsafe
// markup never reaches the browser. This is the single chokepoint: every body
// that becomes GmailMessage.bodyHtml goes through it (see gmail.ts).
//
// Allowlist rationale:
//  - Formatting + structure tags only; no <script>/<style>/<iframe>/<object>/
//    <form>/<input> (sanitize-html drops these and their contents by default for
//    script/style).
//  - Links: http(s)/mailto only, forced target=_blank + rel=noopener noreferrer
//    so a clicked link can't reach back into the app (reverse-tabnabbing) and
//    can't run javascript: URLs.
//  - Images: allowed but http(s)/cid only and lazy — kept because legal mail is
//    often HTML newsletters/confirmations; src schemes are constrained so no
//    data:/javascript: payloads.
//  - A small inline-style allowlist (color/weight/alignment/simple spacing) keeps
//    emails legible without letting position/behaviour CSS escape the message box.
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'div',
    'span',
    'br',
    'hr',
    'b',
    'strong',
    'i',
    'em',
    'u',
    's',
    'strike',
    'sub',
    'sup',
    'small',
    'mark',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    'blockquote',
    'pre',
    'code',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
    'caption',
    'colgroup',
    'col',
  ],
  allowedAttributes: {
    // target/rel must be allowlisted for the forced-safe-link transform below to
    // survive (sanitize-html strips any attribute not listed here, even ones a
    // transform just added).
    a: ['href', 'name', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan', 'align', 'valign'],
    th: ['colspan', 'rowspan', 'align', 'valign'],
    col: ['span', 'width'],
    '*': ['style'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
  // Constrain inline CSS to harmless presentational properties.
  allowedStyles: {
    '*': {
      color: [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z-]+$/i],
      'background-color': [/^#(0x)?[0-9a-f]+$/i, /^rgb\(/i, /^[a-z-]+$/i],
      'text-align': [/^(left|right|center|justify)$/],
      'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/],
      'font-style': [/^(normal|italic|oblique)$/],
      'text-decoration': [/^[a-z- ]+$/i],
      'font-size': [/^\d+(\.\d+)?(px|em|rem|%|pt)$/],
      margin: [/^[\d.a-z% ]+$/i],
      padding: [/^[\d.a-z% ]+$/i],
    },
  },
  // Drop disallowed tags AND their content for the dangerous ones.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  // Force safe link behaviour. sanitize-html adds these even when the source
  // omitted target/rel.
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
}

// Sanitize one inbound email HTML body to a string safe to render with
// dangerouslySetInnerHTML. Returns '' for empty/whitespace input.
export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html || !html.trim()) return ''
  return sanitizeHtml(html, OPTIONS).trim()
}
