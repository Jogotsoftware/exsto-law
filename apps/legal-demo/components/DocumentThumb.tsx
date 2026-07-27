'use client'

import { useMemo, type ReactElement } from 'react'
import { DocumentSheet } from '@/components/DocumentSheet'
import { buildPreview } from '@/lib/templatePreview'

// DOC-RENDER-1 — the ONE document thumbnail. Every card that shows "what this
// document looks like" (the service editor's Templates tab, the template
// gallery, the builder's proposal card in chat) renders through here, so all
// three show the same thing: a true 8.5×11 page with real margins, real
// document typography, and the body rendered as a DOCUMENT — headings, bold,
// lists, tables, alignment, merge fields as gold chips.
//
// It replaces three separate hand-rolled "first N lines as plain text" passes.
// One of those (the service Templates tab) stripped markdown syntax characters
// with a naive `.replace(/[*_>#-]/g, '')` and never escaped HTML, so a body
// carrying inline markup rendered its TAGS as visible body text, hyphens and
// all: `<p style="textalign: center;"<strongOPERATING AGREEMENT OF`. Rendering
// through buildPreview (→ renderDocumentHtml) removes that whole class of bug:
// the body is parsed and SANITIZED, never printed as text.
//
// buildPreview also merges sample data, so the thumbnail reads as a finished
// document rather than a page of raw {{tokens}}.

// A thumbnail clips at the page edge, so only the opening of the body is ever
// visible. Parsing + sanitizing a 20-page agreement to show its first 15 lines
// would be pure waste — and the template gallery renders one of these PER CARD,
// so the whole grid would pay it. Cut to a generous prefix on a LINE boundary
// (never mid-tag, which would hand the renderer a torn element) before rendering.
const THUMB_CHARS = 4000

function thumbSource(body: string): string {
  if (body.length <= THUMB_CHARS) return body
  const cut = body.slice(0, THUMB_CHARS)
  const lastBreak = cut.lastIndexOf('\n')
  return lastBreak > 0 ? cut.slice(0, lastBreak) : cut
}

export function DocumentThumb({
  body,
  title,
  empty = 'No content yet — open the editor.',
  className,
}: {
  /** The template/document body as stored: markdown with {{tokens}}. */
  body: string
  /** Optional running head (e.g. the document kind), rendered above the body. */
  title?: string
  /** Shown instead of the body when there is nothing to render. */
  empty?: string
  className?: string
}): ReactElement {
  const { html } = useMemo(() => buildPreview(thumbSource(body ?? '')), [body])
  const has = (body ?? '').trim().length > 0
  return (
    <DocumentSheet
      variant="thumb"
      serif
      className={className ? `li-docthumb ${className}` : 'li-docthumb'}
    >
      {title ? <div className="li-docthumb-head">{title}</div> : null}
      {has ? (
        // html is sanitized by renderDocumentHtml (lib/documentHtml.ts) via
        // buildPreview — the same security boundary the review, portal, share
        // and e-sign surfaces render through.
        <div className="li-docthumb-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <div className="li-docthumb-empty">{empty}</div>
      )}
    </DocumentSheet>
  )
}
