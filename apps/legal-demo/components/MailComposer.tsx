'use client'

// MailComposer — the rich-text writing surface for the Mail tab (compose + reply).
// A small dependency-free editor: a contentEditable area driven by the browser's
// formatting commands (bold/italic/lists) plus a toolbar. It emits BOTH the HTML
// (what carries the formatting to the recipient) and a derived plaintext fallback,
// so the send path can ship a proper multipart/alternative message.
//
// The firm signature is shown as a read-only preview beneath the editor (like the
// signature block in a real mail client). It is NOT part of the editable body and
// is NOT sent from here — the central send path appends the signature server-side,
// so showing it here is purely so the attorney sees what will be added.
import { useRef, useState } from 'react'

export interface ComposerValue {
  html: string
  text: string
}

// Derive the plaintext fallback from the editor HTML, mirroring the server-side
// html→text read path: <br> and block ends become newlines, the rest is text.
function htmlToPlain(html: string): string {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  tmp.querySelectorAll('br').forEach((br) => br.replaceWith('\n'))
  tmp.querySelectorAll('p, div, li, tr, h1, h2, h3, blockquote').forEach((el) => el.append('\n'))
  return (tmp.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim()
}

interface ToolButton {
  cmd: string
  label: React.ReactNode
  title: string
}

const TOOLS: Array<ToolButton | 'sep'> = [
  { cmd: 'bold', label: <b>B</b>, title: 'Bold (⌘B)' },
  { cmd: 'italic', label: <i>I</i>, title: 'Italic (⌘I)' },
  {
    cmd: 'underline',
    label: <span style={{ textDecoration: 'underline' }}>U</span>,
    title: 'Underline (⌘U)',
  },
  'sep',
  { cmd: 'insertUnorderedList', label: '• List', title: 'Bulleted list' },
  { cmd: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  'sep',
  { cmd: 'removeFormat', label: 'Clear', title: 'Remove formatting' },
]

export function MailComposer({
  placeholder,
  onChange,
  signature,
  minHeight = 150,
}: {
  placeholder?: string
  onChange: (v: ComposerValue) => void
  signature?: string | null
  minHeight?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(true)

  function emit() {
    const el = ref.current
    if (!el) return
    const text = htmlToPlain(el.innerHTML)
    const isEmpty = text.trim().length === 0
    setEmpty(isEmpty)
    // Send no HTML when the body is effectively empty (avoids shipping stray
    // <br>/<div> markup as a "non-empty" body).
    onChange({ html: isEmpty ? '' : el.innerHTML, text })
  }

  function run(cmd: string) {
    document.execCommand(cmd, false)
    ref.current?.focus()
    emit()
  }

  return (
    <div className="composer">
      <div className="composer-toolbar" role="toolbar" aria-label="Text formatting">
        {TOOLS.map((t, i) =>
          t === 'sep' ? (
            <span key={`sep-${i}`} className="composer-sep" aria-hidden="true" />
          ) : (
            <button
              key={t.cmd}
              type="button"
              className="composer-btn"
              title={t.title}
              aria-label={t.title}
              // Keep the editor's selection while clicking a toolbar button.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t.cmd)}
            >
              {t.label}
            </button>
          ),
        )}
      </div>
      <div
        ref={ref}
        className={`composer-area ${empty ? 'is-empty' : ''}`}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-label="Message body"
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        suppressContentEditableWarning
      />
      {signature && signature.trim() ? (
        <div className="composer-signature">
          <span className="composer-signature-label">Signature</span>
          <div className="composer-signature-text">{signature.trim()}</div>
        </div>
      ) : null}
    </div>
  )
}
