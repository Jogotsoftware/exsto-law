import { createElement as h } from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import { marked } from 'marked'
import type { Token, Tokens } from 'marked'

// Server-side markdown → PDF renderer for generated legal-document drafts. Used
// to attach a draft as PDF bytes on an outgoing email. There is no headless
// browser in Netlify functions, so we render with @react-pdf/renderer (pure JS,
// MIT) instead of an HTML-to-PDF pipeline. The markdown is parsed once with
// marked.lexer() and each block token is mapped to a flowing @react-pdf element.
//
// JSX is intentionally avoided here (the vertical builds with plain tsc, no jsx
// runtime in scope at build time) — mirror invoicePdf.ts and use
// React.createElement (`h`) throughout, in a .ts file.

const styles = StyleSheet.create({
  page: {
    paddingVertical: 44,
    paddingHorizontal: 40,
    fontSize: 11,
    lineHeight: 1.5,
    color: '#1f2937',
    fontFamily: 'Helvetica',
  },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', color: '#111827', marginBottom: 6 },
  titleRule: { borderBottomWidth: 1, borderBottomColor: '#9ca3af', marginBottom: 14 },
  // Headings: depth 1 is largest; each deeper level steps down. Bold, with room
  // above so sections breathe.
  h1: {
    fontSize: 17,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 14,
    marginBottom: 6,
  },
  h2: {
    fontSize: 15,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 12,
    marginBottom: 5,
  },
  h3: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 10,
    marginBottom: 4,
  },
  h4: {
    fontSize: 12,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 8,
    marginBottom: 4,
  },
  h5: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#111827',
    marginTop: 8,
    marginBottom: 3,
  },
  h6: {
    fontSize: 11,
    fontFamily: 'Helvetica-Bold',
    color: '#374151',
    marginTop: 8,
    marginBottom: 3,
  },
  paragraph: { marginBottom: 8 },
  listItem: { marginBottom: 3, paddingLeft: 12 },
  blockquote: {
    marginVertical: 6,
    paddingLeft: 10,
    borderLeftWidth: 2,
    borderLeftColor: '#d1d5db',
    color: '#4b5563',
    fontFamily: 'Helvetica-Oblique',
  },
  code: {
    fontFamily: 'Courier',
    fontSize: 10,
    color: '#374151',
    backgroundColor: '#f3f4f6',
    padding: 6,
    marginVertical: 6,
  },
  hr: { borderBottomWidth: 1, borderBottomColor: '#d1d5db', marginVertical: 10 },
  space: { height: 6 },
  strong: { fontFamily: 'Helvetica-Bold' },
  em: { fontFamily: 'Helvetica-Oblique' },
  codespan: { fontFamily: 'Courier', fontSize: 10, color: '#374151' },
})

const HEADING_STYLE = [styles.h1, styles.h2, styles.h3, styles.h4, styles.h5, styles.h6]

// Inline tokens (text/strong/em/codespan/link/...) are flattened into nested
// <Text> spans so a single block <Text> can carry mixed formatting. Unknown
// inline tokens fall back to their `.raw`/`.text` so nothing is silently dropped.
function renderInline(
  tokens: Token[] | undefined,
  raw: string,
  keyPrefix: string,
): React.ReactNode {
  if (!tokens || tokens.length === 0) return raw
  return tokens.map((tok, i) => {
    const key = `${keyPrefix}-${i}`
    switch (tok.type) {
      case 'strong':
        return h(
          Text,
          { key, style: styles.strong },
          renderInline((tok as Tokens.Strong).tokens, (tok as Tokens.Strong).text, key),
        )
      case 'em':
        return h(
          Text,
          { key, style: styles.em },
          renderInline((tok as Tokens.Em).tokens, (tok as Tokens.Em).text, key),
        )
      case 'del':
        return renderInline((tok as Tokens.Del).tokens, (tok as Tokens.Del).text, key)
      case 'codespan':
        return h(Text, { key, style: styles.codespan }, (tok as Tokens.Codespan).text)
      case 'link': {
        const link = tok as Tokens.Link
        const label = renderInline(link.tokens, link.text, key)
        // Show the destination after the text so it survives in a printed PDF.
        return h(Text, { key }, [
          h(Text, { key: 'lbl' }, label),
          link.href && link.href !== link.text
            ? h(Text, { key: 'href', style: styles.codespan }, ` (${link.href})`)
            : null,
        ])
      }
      case 'br':
        return h(Text, { key }, '\n')
      case 'text': {
        const t = tok as Tokens.Text
        // A text token can itself nest inline tokens (e.g. inside a list item).
        return t.tokens && t.tokens.length > 0
          ? renderInline(t.tokens, t.text, key)
          : (t.text ?? t.raw)
      }
      default: {
        // Unknown inline kind: never drop content — fall back to raw/text.
        const g = tok as Tokens.Generic
        return (g.text as string) ?? g.raw ?? ''
      }
    }
  })
}

function renderListItems(list: Tokens.List, keyPrefix: string): React.ReactNode[] {
  return list.items.map((item, i) => {
    const marker = list.ordered
      ? `${(typeof list.start === 'number' ? list.start : 1) + i}. `
      : '• '
    const key = `${keyPrefix}-li-${i}`
    return h(Text, { key, style: styles.listItem }, [
      h(Text, { key: 'm' }, marker),
      h(Text, { key: 'c' }, renderInline(item.tokens, item.text, key)),
    ])
  })
}

// Map one block-level token to a single flowing element. Returning the element
// (not pushing into a fixed-height View) lets react-pdf paginate automatically.
function renderBlock(token: Token, key: string): React.ReactNode {
  switch (token.type) {
    case 'heading': {
      const heading = token as Tokens.Heading
      const depth = Math.min(Math.max(heading.depth, 1), 6)
      return h(
        Text,
        { key, style: HEADING_STYLE[depth - 1] },
        renderInline(heading.tokens, heading.text, key),
      )
    }
    case 'paragraph': {
      const p = token as Tokens.Paragraph
      return h(Text, { key, style: styles.paragraph }, renderInline(p.tokens, p.text, key))
    }
    case 'list':
      return h(View, { key, style: styles.paragraph }, renderListItems(token as Tokens.List, key))
    case 'blockquote': {
      const bq = token as Tokens.Blockquote
      return h(Text, { key, style: styles.blockquote }, renderInline(bq.tokens, bq.text, key))
    }
    case 'code': {
      const c = token as Tokens.Code
      return h(Text, { key, style: styles.code }, c.text)
    }
    case 'codespan':
      return h(Text, { key, style: styles.codespan }, (token as Tokens.Codespan).text)
    case 'hr':
      return h(View, { key, style: styles.hr })
    case 'space':
      return h(View, { key, style: styles.space })
    default: {
      // Unknown block kind (html, table, def, ...): render its text/raw as a
      // plain paragraph rather than dropping or crashing on it.
      const g = token as Tokens.Generic
      const fallback = (g.text as string) ?? g.raw ?? ''
      if (!fallback.trim()) return null
      return h(Text, { key, style: styles.paragraph }, fallback)
    }
  }
}

/**
 * Render a markdown draft to PDF bytes. Pure and deterministic — no network, no
 * clock, no randomness. `opts.title` (if given) prints as a bold title with a
 * rule under it. Long drafts paginate automatically across LETTER pages.
 */
// Cap the source markdown so a pathologically large draft can't OOM/stall the
// render (tokenize + react-pdf layout happen before any output-size guard). 1 MB
// covers any real legal draft.
const MAX_DRAFT_MARKDOWN_BYTES = 1_000_000

export async function renderDraftPdf(markdown: string, opts?: { title?: string }): Promise<Buffer> {
  const md = markdown ?? ''
  if (md.length > MAX_DRAFT_MARKDOWN_BYTES) {
    throw new Error('Draft is too large to render as a PDF attachment.')
  }
  const tokens = marked.lexer(md)

  const body = tokens.map((tok, i) => renderBlock(tok, `b-${i}`)).filter(Boolean)

  const title = opts?.title?.trim()
  const head = title
    ? [
        h(Text, { key: 'title', style: styles.title }, title),
        h(View, { key: 'titleRule', style: styles.titleRule }),
      ]
    : []

  const doc = h(
    Document,
    null,
    // Body is a flowing sequence of elements directly under <Page> (no fixed
    // wrapping View), so react-pdf wraps content across pages instead of clipping.
    h(Page, { size: 'LETTER', style: styles.page }, [...head, ...body]),
  )

  return renderToBuffer(doc)
}
