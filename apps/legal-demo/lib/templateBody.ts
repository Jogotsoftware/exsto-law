import TurndownService from 'turndown'
import { Marked } from 'marked'

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
const md = new Marked({ gfm: true, breaks: true })

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

// A bare merge token: {{client_name}}. Deliberately NOT matched: {{>include_key}}
// and {{type:signer}} e-sign tags carry `>`/`:` (outside [a-zA-Z0-9_]), so they
// stay as plain text and are never turned into editable chips.
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html ?? '')
}

export function markdownToHtml(body: string): string {
  const html = md.parse(body ?? '', { async: false }) as string
  // Re-hydrate {{token}} markers into TipTap variable spans so they load as
  // atomic chips (not editable literal text). The turndown rule above reverses this.
  return html.replace(
    TOKEN_RE,
    (_m, name: string) => `<span data-variable="${name}">{{${name}}}</span>`,
  )
}
