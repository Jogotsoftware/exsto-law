// Tiny markdown renderer (subset: headings, bold, italic, code, lists, hr,
// tables, paragraphs) — good enough for the legal drafts the agent produces.
// Escapes HTML before applying inline syntax so output is safe to inject. This
// is kept for the assistant CHAT (which must not render rich document
// styling); the Brief modal (BriefModal.tsx) reuses it for the same reason —
// brief markdown is model output, not attorney-authored document content, so
// it gets the same escape-everything treatment as chat, not the sanitized
// inline-HTML subset documents get. The finished DOCUMENT paths (preview/
// share/review/e-sign/PDF/Word) use renderDocumentHtml, which sanitizes an
// allowlisted styling subset instead of escaping it.
//
// PO-1: GFM pipe tables (`| a | b |` header + `| --- | --- |` separator) were
// previously unhandled — the raw `| Item | Status |` text rendered literally
// inside the Brief modal's checklist sections. Table cells now render as a
// real <table>. `opts.tdWrap` is an optional per-cell post-processor (raw
// trimmed cell text + its inline-formatted HTML in, replacement HTML out) —
// BriefModal uses it to wrap known status vocabulary in color-coded chips
// (lib/briefChips.ts); every other caller omits it and gets a plain <td>.

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

// Splits a `| a | b\|c |` row into ['a', 'b|c'] — trims each cell, drops one
// leading/trailing empty cell from optional outer pipes, and unescapes `\|`.
function splitTableRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\' && s[i + 1] === '|') {
      buf += '|'
      i++
      continue
    }
    if (c === '|') {
      cells.push(buf.trim())
      buf = ''
      continue
    }
    buf += c
  }
  cells.push(buf.trim())
  return cells
}

const TABLE_ALIGN_CELL = /^:?-+:?$/

// A GFM separator row ("| --- | :---: |"). Requires at least one pipe so a
// bare `---` line stays the existing <hr/> rule, never mistaken for a
// (nonsensical) one-column table.
function isTableSeparatorRow(line: string): boolean {
  const trimmed = line.trim()
  if (!trimmed.includes('|')) return false
  const cells = splitTableRow(trimmed)
  return cells.length > 0 && cells.every((c) => TABLE_ALIGN_CELL.test(c))
}

function tableAlign(cell: string): 'left' | 'right' | 'center' | null {
  const left = cell.startsWith(':')
  const right = cell.endsWith(':')
  if (left && right) return 'center'
  if (right) return 'right'
  if (left) return 'left'
  return null
}

function renderTable(
  header: string[],
  aligns: Array<'left' | 'right' | 'center' | null>,
  rows: string[][],
  tdWrap?: (cellText: string, cellHtml: string) => string,
): string {
  const alignStyle = (i: number): string => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '')
  const theadCells = header.map((h, i) => `<th${alignStyle(i)}>${inlineFormat(h)}</th>`).join('')
  const tbodyRows = rows
    .map((row) => {
      const tds = header
        .map((_, i) => {
          const raw = row[i] ?? ''
          const html = inlineFormat(raw)
          return `<td${alignStyle(i)}>${tdWrap ? tdWrap(raw, html) : html}</td>`
        })
        .join('')
      return `<tr>${tds}</tr>`
    })
    .join('')
  return `<div class="li-md-table-wrap"><table><thead><tr>${theadCells}</tr></thead><tbody>${tbodyRows}</tbody></table></div>`
}

export function renderMarkdown(
  md: string,
  opts?: { tdWrap?: (cellText: string, cellHtml: string) => string },
): string {
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

  let i = 0
  while (i < lines.length) {
    const raw = lines[i]!
    const line = raw.trim()

    // GFM pipe table: a row containing '|' whose NEXT line is a valid
    // separator row starts a table. Consume header + separator, then every
    // consecutive non-blank '|' row after as a data row.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparatorRow(lines[i + 1]!)) {
      flushParagraph()
      closeList()
      const headerCells = splitTableRow(line)
      const aligns = splitTableRow(lines[i + 1]!).map(tableAlign)
      i += 2
      const bodyRows: string[][] = []
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        bodyRows.push(splitTableRow(lines[i]!))
        i++
      }
      out.push(renderTable(headerCells, aligns, bodyRows, opts?.tdWrap))
      continue
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/)
    if (h) {
      flushParagraph()
      closeList()
      const level = h[1]!.length
      out.push(`<h${level}>${inlineFormat(h[2]!)}</h${level}>`)
      i++
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
      i++
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
      i++
      continue
    }

    if (/^-{3,}$/.test(line)) {
      flushParagraph()
      closeList()
      out.push('<hr/>')
      i++
      continue
    }

    if (line === '') {
      flushParagraph()
      closeList()
      i++
      continue
    }

    closeList()
    inParagraph = true
    buf.push(inlineFormat(line))
    i++
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
  table { border-collapse: collapse; width: 100%; margin: 0 0 12pt; }
  th, td { border: 1pt solid #888; padding: 4pt 8pt; vertical-align: top; text-align: left; }
  th { background: #f0f0f0; font-weight: 700; }
  th p, td p { margin: 0; }
  th[align='center'], td[align='center'] { text-align: center; }
  th[align='right'], td[align='right'] { text-align: right; }
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
  // EDITOR-FIX-1 (item 7): `font` (CSS stack + pt size) applies the per-document
  // base font to the printed page, so a PDF export matches the editor/reader.
  opts?: { status?: string | null; font?: { family: string; size: number } },
): void {
  const html = renderDocumentHtml(markdown)
  const wm = watermarkForStatus(opts?.status)
  const inner = wm ? `${watermarkHtml(wm, true)}${html}` : html
  const body = opts?.font
    ? `<div style="font-family:${opts.font.family};font-size:${opts.font.size}pt">${inner}</div>`
    : inner
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
  opts?: { status?: string | null; font?: { family: string; size: number } },
): void {
  const html = renderDocumentHtml(markdown)
  const wm = watermarkForStatus(opts?.status)
  // Word ignores position:fixed — the banner alone marks every Word export.
  const inner = wm ? `${watermarkHtml(wm, false)}${html}` : html
  const body = opts?.font
    ? `<div style="font-family:${opts.font.family};font-size:${opts.font.size}pt">${inner}</div>`
    : inner
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
    args.attorneyName ?? 'The firm',
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
