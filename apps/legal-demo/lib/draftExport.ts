// Tiny markdown renderer (subset: headings, bold, italic, code, lists, hr,
// paragraphs) — good enough for the legal drafts the agent produces. Escapes HTML
// before applying inline syntax so output is safe to inject.

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

    const ol = line.match(/^\d+\.\s+(.+)$/)
    if (ol) {
      flushParagraph()
      if (inList !== 'ol') {
        closeList()
        out.push('<ol>')
        inList = 'ol'
      }
      out.push(`<li>${inlineFormat(ol[1]!)}</li>`)
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
  h1 { font-size: 18pt; margin: 0 0 14pt; }
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

export function downloadAsPdf(markdown: string, title: string): void {
  const html = renderMarkdown(markdown)
  const w = window.open('', '_blank')
  if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to export PDF.')
    return
  }
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PRINT_STYLES}</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script></body></html>`,
  )
  w.document.close()
}

export function downloadAsWord(markdown: string, filename: string): void {
  const html = renderMarkdown(markdown)
  const fullHtml = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(filename)}</title><style>${PRINT_STYLES}</style></head>
<body>${html}</body>
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
