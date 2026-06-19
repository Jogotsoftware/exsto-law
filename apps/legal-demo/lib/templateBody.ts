import TurndownService from 'turndown'
import { marked } from 'marked'

// Client-side markdown ⇆ HTML conversion for the rich template editor.
//
// Templates are STORED as markdown (the deterministic merge engine and the
// drafting pipeline operate on `{{token}}` markdown — Contract H). TipTap edits
// HTML, so we convert at the page boundary only: markdown → HTML to seed the
// editor, HTML → markdown to save. Storage and every server path stay markdown.
//
// Mirrors verticals/legal/src/templates/bodyConversion.ts (kept in lockstep);
// duplicated here so the client bundle never imports server vertical code.

marked.setOptions({ gfm: true, breaks: true })

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
})

// TipTap renders a template variable as <span data-variable="name">{{name}}</span>.
// Collapse it back to {{name}} so the saved body is plain markdown.
turndown.addRule('templateVariableSpan', {
  filter: (node) => node.nodeName === 'SPAN' && (node as HTMLElement).hasAttribute('data-variable'),
  replacement: (_content, node) =>
    `{{${(node as HTMLElement).getAttribute('data-variable') ?? ''}}}`,
})

const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html ?? '')
}

export function markdownToHtml(md: string): string {
  const html = marked.parse(md ?? '', { async: false }) as string
  // Re-hydrate {{token}} markers into TipTap variable spans so they load as
  // atomic chips (not editable literal text). The turndown rule above reverses this.
  return html.replace(
    TOKEN_RE,
    (_m, name: string) => `<span data-variable="${name}">{{${name}}}</span>`,
  )
}
