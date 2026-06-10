import TurndownService from 'turndown'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '_',
})

// TipTap renders variables as <span data-variable="name">{{name}}</span>.
// Collapse them back to {{name}} so the drafting prompt sees plain markdown.
interface AttrNode {
  hasAttribute(name: string): boolean
  getAttribute(name: string): string | null
}
turndown.addRule('templateVariableSpan', {
  filter: (node) =>
    node.nodeName === 'SPAN' && (node as unknown as AttrNode).hasAttribute('data-variable'),
  replacement: (_content, node) => {
    const name = (node as unknown as AttrNode).getAttribute('data-variable') ?? ''
    return `{{${name}}}`
  },
})

export function htmlToMarkdown(html: string): string {
  return turndown.turndown(html ?? '')
}

export function markdownToHtml(md: string): string {
  return marked.parse(md ?? '', { async: false }) as string
}

export function extractVariables(body: string): string[] {
  if (!body) return []
  const seen = new Set<string>()
  const out: string[] = []
  const re = /\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const name = m[1]!
    if (!seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}
