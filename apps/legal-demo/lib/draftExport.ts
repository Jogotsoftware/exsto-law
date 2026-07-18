// Tiny markdown renderer (subset: headings, bold, italic, code, lists, hr,
// paragraphs) — good enough for the legal drafts the agent produces. Escapes HTML
// before applying inline syntax so output is safe to inject. This is kept for the
// assistant CHAT (which must not render rich document styling). The finished
// DOCUMENT paths (preview/share/review/e-sign/PDF/Word) use renderDocumentHtml,
// which sanitizes an allowlisted styling subset instead of escaping it.

import { renderDocumentHtml } from './documentHtml'

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function inlineFormat(text: string): string {
  return (
    escapeHtml(text)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>')
      // Markdown links [label](url). The url is already HTML-escaped; allow only
      // safe schemes — external http(s) (new tab), in-app relative paths, mailto —
      // so a javascript:/data: url is left as literal text, never an href.
      .replace(/\[([^\]]+)\]\(([^)\s"]+)\)/g, (whole, label: string, url: string) => {
        if (!/^(https?:\/\/|\/|mailto:)/i.test(url)) return whole
        const external = /^https?:\/\//i.test(url)
        const attrs = external ? ' target="_blank" rel="noopener noreferrer"' : ''
        return `<a href="${url}"${attrs}>${label}</a>`
      })
  )
}

export function renderMarkdown(md: string): string {
  const lines = md.split('\n')
  const out: string[] = []
  let inList: 'ul' | 'ol' | null = null
  let inParagraph = false
  const buf: string[] = []

  function flushParagraph() {
    if (inParagraph) {
      out.push(`<p>${buf.join(' ')}</p>`)
      buf.length = 0
      inParagraph = false
    }
  }
  function closeList() {
    if (inList) {
      out.push(`</${inList}>`)
      inList = null
    }
  }

  for (const raw of lines) {
    const line = raw.trim()

    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      flushParagraph()
      closeList()
      const level = h[1]!.length
      out.push(`<h${level}>${inlineFormat(h[2]!)}</h${level}>`)
      continue
    }

    // Capture the item number to support start= attribute when restarting a list
    // after a blank line (which closes the ol). This fixes numbered lists that are
    // interrupted by blank lines, e.g. "1. item\n\n2. item" now renders as two
    // separate lists where the second starts at 2, not both at 1.
    const ol = line.match(/^(\d+)\.\s+(.+)$/)
    if (ol) {
      flushParagraph()
      if (inList !== 'ol') {
        closeList()
        const startNum = parseInt(ol[1]!, 10)
        const olTag = startNum !== 1 ? `<ol start="${startNum}">` : '<ol>'
        out.push(olTag)
        inList = 'ol'
      }
      out.push(`<li>${inlineFormat(ol[2]!)}</li>`)
      continue
    }

    const ul = line.match(/^[-*]\s+(.+)$/)
    if (ul) {
      flushParagraph()
      if (inList !== 'ul') {
        closeList()
        out.push('<ul>')
        inList = 'ul'
      }
      out.push(`<li>${inlineFormat(ul[1]!)}</li>`)
      continue
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph()
      closeList()
      out.push('<hr/>')
      continue
    }

    if (line === '') {
      flushParagraph()
      closeList()
      continue
    }

    closeList()
    inParagraph = true
    buf.push(inlineFormat(line))
  }
  flushParagraph()
  closeList()
  return out.join('\n')
}

// P13 — the DRAFT watermark is RENDER STATE keyed off the version status, never
// text baked into a template or draft body. Mirrors the vertical's rule in
// verticals/legal/src/render/draftPdf.ts (server-rendered mail attachments);
// duplicated here because this module ships in the client bundle.
export const DRAFT_WATERMARK_TEXT = 'DRAFT — pending attorney approval'

// The watermark text for a version status, or null when the document is final
// (approved / executed) or the caller has no status to key off.
export function watermarkForStatus(status: string | null | undefined): string | null {
  if (!status) return null
  return status === 'approved' || status === 'executed' ? null : DRAFT_WATERMARK_TEXT
}

// Watermark markup for the export windows: a bordered banner (also survives the
// Word export, where positioned elements don't) + a repeating diagonal stamp
// (position:fixed prints on every page).
function watermarkHtml(watermark: string, withOverlay: boolean): string {
  const wm = escapeHtml(watermark)
  return (
    `<div class="doc-wm-banner">${wm}</div>` +
    (withOverlay ? `<div class="doc-wm-overlay" aria-hidden="true">${wm}</div>` : '')
  )
}

const WATERMARK_PRINT_STYLES = `
  .doc-wm-banner {
    text-align: center;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #b45309;
    border: 1.5pt solid #b45309;
    padding: 6pt 10pt;
    margin: 0 0 18pt;
  }
  .doc-wm-overlay {
    position: fixed;
    top: 42%;
    left: 0;
    right: 0;
    text-align: center;
    transform: rotate(-24deg);
    font-family: Arial, Helvetica, sans-serif;
    font-size: 40pt;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: rgba(180, 83, 9, 0.12);
    pointer-events: none;
  }
`

// Print-friendly stylesheet shared between the in-page preview and the
// new-window print/PDF view.
const PRINT_STYLES = `
  body {
    font-family: Georgia, 'Times New Roman', serif;
    max-width: 7in;
    margin: 1in auto;
    line-height: 1.7;
    color: #111;
    font-size: 11pt;
  }
  h1 { font-size: 18pt; margin: 0 0 14pt; text-align: center; }
  h2 { font-size: 14pt; margin: 22pt 0 10pt; }
  h3 { font-size: 12pt; margin: 18pt 0 8pt; }
  p  { margin: 0 0 10pt; }
  ul, ol { margin: 0 0 10pt 22pt; padding: 0; }
  li { margin-bottom: 4pt; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  code {
    font-family: 'Courier New', monospace;
    font-size: 9.5pt;
    background: #f4f4f4;
    padding: 1pt 3pt;
    border-radius: 2px;
  }
  hr { border: none; border-top: 1px solid #999; margin: 18pt 0; }
  @media print {
    @page { margin: 1in; }
    body { margin: 0; max-width: none; }
  }
`

// `opts.status` (the document_version status) keys the draft watermark: a
// version that is not approved/executed exports with the watermark. Callers with
// no version status (e.g. chat-generated markdown) omit it — no watermark.
export function downloadAsPdf(
  markdown: string,
  title: string,
  opts?: { status?: string | null },
): void {
  const html = renderDocumentHtml(markdown)
  const wm = watermarkForStatus(opts?.status)
  const body = wm ? `${watermarkHtml(wm, true)}${html}` : html
  const w = window.open('', '_blank')
  if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to export PDF.')
    return
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}${WATERMARK_PRINT_STYLES}</style></head><body>${body}<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`,
  )
  w.document.close()
}

export function downloadAsWord(
  markdown: string,
  filename: string,
  opts?: { status?: string | null },
): void {
  const html = renderDocumentHtml(markdown)
  const wm = watermarkForStatus(opts?.status)
  // Word ignores position:fixed — the banner alone marks every Word export.
  const body = wm ? `${watermarkHtml(wm, false)}${html}` : html
  const fullHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(filename)}</title><style>${PRINT_STYLES}${WATERMARK_PRINT_STYLES}</style></head>
<body>${body}</body>
</html>`
  // BOM + msword mime so Word picks it up cleanly.
  const blob = new Blob(['﻿', fullHtml], { type: 'application/msword' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}.doc`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

interface EmailDraftArgs {
  to?: string
  documentTitle: string
  matterNumber: string
  shareUrl: string
  attorneyName?: string
}

export function openGmailDraft(args: EmailDraftArgs): void {
  const subject = `Your draft ${args.documentTitle} — ${args.matterNumber}`
  const body = [
    `Hi,`,
    ``,
    `Your draft ${args.documentTitle.toLowerCase()} is ready for review:`,
    ``,
    args.shareUrl,
    ``,
    `You can view it in your browser and download a PDF or Word copy from the page.`,
    ``,
    `Take a look at your convenience and let me know if you have questions.`,
    ``,
    `Best,`,
    args.attorneyName ?? 'Pacheco Law',
  ].join('\n')
  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    su: subject,
    body,
  })
  if (args.to) params.set('to', args.to)
  window.open(`https://mail.google.com/mail/?${params.toString()}`, '_blank')
}

export function shareUrlFor(versionId: string): string {
  if (typeof window === 'undefined') return `/d/${versionId}`
  return `${window.location.origin}/d/${versionId}`
}
