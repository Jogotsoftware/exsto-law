'use client'

// MailComposer — the rich-text writing surface for the Mail tab (compose + reply).
// A small dependency-free editor: a contentEditable area driven by the browser's
// formatting commands plus a toolbar (bold/italic/underline, font family + size,
// text colour, lists, links). It emits BOTH the HTML (what carries the formatting
// to the recipient) and a derived plaintext fallback, so the send path can ship a
// proper multipart/alternative message.
//
// Anything below the editor (the signature block) is passed in via `footer` — the
// composer itself stays presentational and never talks to the substrate.
import { useEffect, useRef, useState } from 'react'

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

// Font choices use real CSS stacks so they render in the recipient's mail client.
const FONTS: Array<{ label: string; value: string }> = [
  { label: 'Sans-serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Fixed width', value: '"Courier New", monospace' },
]

// execCommand('fontSize') takes the legacy 1–7 scale; these are the useful ones.
const SIZES: Array<{ label: string; value: string }> = [
  { label: 'Small', value: '2' },
  { label: 'Normal', value: '3' },
  { label: 'Large', value: '5' },
  { label: 'Huge', value: '6' },
]

// Photos are inserted as data URLs and converted to proper inline MIME parts at
// send time (Gmail refuses data: images in received mail). Cap the file so the
// signature/body stays a sane size — matches the invoice-logo limit.
const MAX_IMAGE_BYTES = 500 * 1024

export function MailComposer({
  placeholder,
  onChange,
  footer,
  minHeight = 150,
  initialHtml,
  disabled = false,
}: {
  placeholder?: string
  onChange: (v: ComposerValue) => void
  footer?: React.ReactNode
  minHeight?: number
  // Seed content for edit surfaces (e.g. the saved signature). Applied once on
  // mount — the editor is uncontrolled; remount (key) to reseed.
  initialHtml?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  // The editor's selection at the moment a toolbar control that steals focus
  // (a <select>, the colour picker, the link field) was activated — restored
  // before the command runs so it lands on the text you had highlighted.
  const savedRange = useRef<Range | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const [empty, setEmpty] = useState(true)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [imgError, setImgError] = useState<string | null>(null)

  function emit() {
    const el = ref.current
    if (!el) return
    const text = htmlToPlain(el.innerHTML)
    // An image-only body (e.g. a photo signature) has no text but is not empty.
    const isEmpty = text.trim().length === 0 && !el.querySelector('img')
    setEmpty(isEmpty)
    // Send no HTML when the body is effectively empty (avoids shipping stray
    // <br>/<div> markup as a "non-empty" body).
    onChange({ html: isEmpty ? '' : el.innerHTML, text })
  }

  useEffect(() => {
    if (initialHtml && ref.current) {
      ref.current.innerHTML = initialHtml
      emit()
    }
    // Seed once on mount only — the editor is uncontrolled after that.
  }, [])

  function insertImage(file: File) {
    setImgError(null)
    if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) {
      setImgError('Use a PNG, JPG, GIF or WebP image.')
      return
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImgError('Image is too large — keep it under 500 KB.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = reader.result as string
      ref.current?.focus()
      restoreSelection()
      document.execCommand(
        'insertHTML',
        false,
        `<img src="${dataUrl}" alt="" style="max-width:240px;height:auto">`,
      )
      saveSelection()
      emit()
    }
    reader.readAsDataURL(file)
  }

  function saveSelection() {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0) return
    const range = sel.getRangeAt(0)
    if (ref.current?.contains(range.commonAncestorContainer)) {
      savedRange.current = range.cloneRange()
    }
  }

  function restoreSelection() {
    const sel = window.getSelection()
    const r = savedRange.current
    if (sel && r) {
      sel.removeAllRanges()
      sel.addRange(r)
    }
  }

  // For toolbar buttons that keep focus in the editor (onMouseDown preventDefault):
  // the live selection is intact, so run the command directly.
  function run(cmd: string, arg?: string) {
    ref.current?.focus()
    document.execCommand(cmd, false, arg)
    emit()
  }

  // For controls that take focus away first (selects, colour, link): restore the
  // saved selection, then run the command against it.
  function applyToSaved(cmd: string, arg?: string) {
    ref.current?.focus()
    restoreSelection()
    document.execCommand(cmd, false, arg)
    saveSelection()
    emit()
  }

  function applyLink() {
    const url = linkUrl.trim()
    setLinkOpen(false)
    setLinkUrl('')
    if (!url) return
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
    ref.current?.focus()
    restoreSelection()
    const sel = window.getSelection()
    if (sel && sel.toString().trim()) {
      document.execCommand('createLink', false, href)
    } else {
      // No text selected — drop the URL in as its own link.
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${href}">${href.replace(/</g, '&lt;')}</a>`,
      )
    }
    saveSelection()
    emit()
  }

  return (
    <div className="composer" style={disabled ? { opacity: 0.55 } : undefined}>
      <div
        className="composer-toolbar"
        role="toolbar"
        aria-label="Text formatting"
        style={disabled ? { pointerEvents: 'none' } : undefined}
      >
        <button
          type="button"
          className="composer-btn"
          title="Bold (⌘B)"
          aria-label="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('bold')}
        >
          <b>B</b>
        </button>
        <button
          type="button"
          className="composer-btn"
          title="Italic (⌘I)"
          aria-label="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('italic')}
        >
          <i>I</i>
        </button>
        <button
          type="button"
          className="composer-btn"
          title="Underline (⌘U)"
          aria-label="Underline"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('underline')}
        >
          <span style={{ textDecoration: 'underline' }}>U</span>
        </button>

        <span className="composer-sep" aria-hidden="true" />

        <select
          className="composer-select"
          title="Font"
          aria-label="Font family"
          defaultValue=""
          onMouseDown={saveSelection}
          onChange={(e) => {
            applyToSaved('fontName', e.target.value)
            e.target.selectedIndex = 0
          }}
        >
          <option value="" disabled>
            Font
          </option>
          {FONTS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <select
          className="composer-select"
          title="Text size"
          aria-label="Text size"
          defaultValue=""
          onMouseDown={saveSelection}
          onChange={(e) => {
            applyToSaved('fontSize', e.target.value)
            e.target.selectedIndex = 0
          }}
        >
          <option value="" disabled>
            Size
          </option>
          {SIZES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>

        <label className="composer-color" title="Text colour">
          <span aria-hidden="true">A</span>
          <input
            type="color"
            aria-label="Text colour"
            defaultValue="#1e3a8a"
            onMouseDown={saveSelection}
            onChange={(e) => applyToSaved('foreColor', e.target.value)}
          />
        </label>

        <span className="composer-sep" aria-hidden="true" />

        <button
          type="button"
          className="composer-btn"
          title="Bulleted list"
          aria-label="Bulleted list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('insertUnorderedList')}
        >
          • List
        </button>
        <button
          type="button"
          className="composer-btn"
          title="Numbered list"
          aria-label="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('insertOrderedList')}
        >
          1. List
        </button>
        <button
          type="button"
          className={`composer-btn ${linkOpen ? 'is-active' : ''}`}
          title="Insert link"
          aria-label="Insert link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            saveSelection()
            setLinkOpen((v) => !v)
          }}
        >
          🔗 Link
        </button>
        <button
          type="button"
          className="composer-btn"
          title="Insert photo (PNG/JPG, under 500 KB)"
          aria-label="Insert photo"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            saveSelection()
            fileRef.current?.click()
          }}
        >
          🖼️ Photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) insertImage(f)
            e.target.value = ''
          }}
        />

        <span className="composer-sep" aria-hidden="true" />

        <button
          type="button"
          className="composer-btn"
          title="Remove formatting"
          aria-label="Remove formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => run('removeFormat')}
        >
          Clear
        </button>
      </div>

      {linkOpen && (
        <div className="composer-link-row">
          <input
            type="url"
            placeholder="https://example.com"
            value={linkUrl}
            autoFocus
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyLink()
              } else if (e.key === 'Escape') {
                setLinkOpen(false)
                setLinkUrl('')
              }
            }}
          />
          <button
            type="button"
            className="composer-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={applyLink}
          >
            Apply
          </button>
          <button
            type="button"
            className="composer-btn"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setLinkOpen(false)
              setLinkUrl('')
            }}
          >
            Cancel
          </button>
        </div>
      )}

      {imgError && <div className="composer-link-row">{imgError}</div>}

      <div
        ref={ref}
        className={`composer-area ${empty ? 'is-empty' : ''}`}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label="Message body"
        data-placeholder={placeholder}
        style={{ minHeight }}
        onInput={emit}
        onKeyUp={saveSelection}
        onMouseUp={saveSelection}
        suppressContentEditableWarning
      />

      {footer}
    </div>
  )
}
