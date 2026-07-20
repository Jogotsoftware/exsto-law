'use client'

// MailComposer — the rich-text writing surface for the Mail tab (compose + reply).
// Rebuilt on TipTap (the same engine as the template editor) so composing feels
// like Word: a real undo history, per-run font family/size in points, headings,
// alignment, lists, quotes and links. The external contract is unchanged — it
// emits BOTH the HTML (what carries the formatting to the recipient) and a
// derived plaintext fallback, so the send path can ship a proper
// multipart/alternative message.
//
// Anything below the editor (the signature block) is passed in via `footer` — the
// composer itself stays presentational and never talks to the substrate.
import { Node } from '@tiptap/core'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, FontFamily, FontSize } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { useEffect, useRef, useState } from 'react'
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BoldIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  QuoteIcon,
  RedoIcon,
  StrikethroughIcon,
  UnderlineIcon,
  UndoIcon,
} from '@/components/icons'

export interface ComposerValue {
  html: string
  text: string
}

// Font choices use real CSS stacks so they render in the recipient's mail client.
const FONTS: Array<{ label: string; value: string }> = [
  { label: 'Sans-serif', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Serif', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Fixed width', value: '"Courier New", monospace' },
]

// Point sizes offered in the size picker — stored as font-size:<n>pt inline
// styles, which mail clients honor.
const SIZES = ['10', '11', '12', '14', '18', '24']

// Photos are inserted as data URLs and converted to proper inline MIME parts at
// send time (Gmail refuses data: images in received mail). Cap the file so the
// signature/body stays a sane size — matches the invoice-logo limit.
const MAX_IMAGE_BYTES = 500 * 1024

// @tiptap/extension-image is not a dependency, and without an image node in the
// schema TipTap silently DROPS <img> tags — both on photo insert and when
// seeding a saved signature that contains one. This minimal inline node keeps
// <img src> through parse/serialize; nothing more.
const InlineImage = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  draggable: true,
  addAttributes() {
    return {
      src: { default: null },
      alt: { default: '' },
      style: { default: 'max-width:240px;height:auto' },
    }
  },
  parseHTML() {
    return [{ tag: 'img[src]' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes]
  },
})

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
  // Parent callbacks are read live through a ref so the onUpdate closure
  // (created once, at editor creation) never calls a stale onChange.
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const fileRef = useRef<HTMLInputElement>(null)
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [imgError, setImgError] = useState<string | null>(null)

  function emit(ed: Editor): void {
    const text = ed
      .getText({ blockSeparator: '\n' })
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    // An image-only body (e.g. a photo signature) has no text but is not empty.
    const isEmpty = text.length === 0 && !ed.getHTML().includes('<img')
    // Send no HTML when the body is effectively empty (avoids shipping an empty
    // <p></p> as a "non-empty" body).
    onChangeRef.current({ html: isEmpty ? '' : ed.getHTML(), text })
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // Link (and Underline) ship inside StarterKit v3 — configure the
        // built-in rather than registering @tiptap/extension-link twice.
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
      }),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      // Per-run typography. FontFamily + FontSize attach to TextStyle and
      // serialize to <span style="font-family|font-size"> — inline styles that
      // survive mail clients.
      TextStyle,
      FontFamily,
      FontSize,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      InlineImage,
    ],
    content: initialHtml || '',
    immediatelyRender: false,
    // Email-sized documents: re-render on every transaction so the toolbar's
    // active states and the font/size selects track the caret like Word.
    shouldRerenderOnTransaction: true,
    editable: !disabled,
    onCreate: ({ editor: ed }) => {
      // Mirror the old composer: seeding fires one onChange, so parents that
      // hold the "current value" (the signature editors) see the seed without
      // requiring an edit first.
      if (initialHtml) emit(ed)
    },
    onUpdate: ({ editor: ed }) => emit(ed),
    editorProps: {
      attributes: {
        // Keep the .composer-area class so the existing globals.css shell
        // (padding, typography, focus ring via .composer) still applies. The
        // stylesheet caps the area at max-height:360px — tall surfaces (the
        // compose/reply body; default minHeight 150) override it inline so a
        // long email gets a Word-sized page, while the small signature editors
        // (minHeight ~100) keep the compact cap.
        class: 'composer-area',
        style: `min-height:${minHeight}px${minHeight >= 150 ? ';max-height:58vh' : ''}`,
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Message body',
      },
    },
  })

  // The signature settings page toggles `disabled` live (no remount).
  useEffect(() => {
    if (editor) editor.setEditable(!disabled)
  }, [editor, disabled])

  function applyLink(): void {
    const url = linkUrl.trim()
    setLinkOpen(false)
    setLinkUrl('')
    if (!editor || !url) return
    const href = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // No text selected — drop the URL in as its own link.
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
    }
  }

  function insertImage(file: File): void {
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
      editor
        ?.chain()
        .focus()
        .insertContent({ type: 'image', attrs: { src: dataUrl } })
        .run()
    }
    reader.readAsDataURL(file)
  }

  if (!editor) {
    // SSR / first client render (immediatelyRender: false) — keep the shell so
    // layout doesn't jump when the editor mounts.
    return (
      <div className="composer">
        <div className="composer-area" style={{ minHeight }} />
        {footer}
      </div>
    )
  }

  return (
    <div className="composer" style={disabled ? { opacity: 0.55 } : undefined}>
      <Toolbar
        editor={editor}
        disabled={disabled}
        linkOpen={linkOpen}
        onToggleLink={() => {
          setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '')
          setLinkOpen((v) => !v)
        }}
        onPickImage={() => fileRef.current?.click()}
      />
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

      <EditorContent editor={editor} />

      {footer}
    </div>
  )
}

// The Word-like formatting strip. Buttons run TipTap commands and reflect the
// caret's live formatting; selects show the current per-run font family/size.
function Toolbar({
  editor,
  disabled,
  linkOpen,
  onToggleLink,
  onPickImage,
}: {
  editor: Editor
  disabled: boolean
  linkOpen: boolean
  onToggleLink: () => void
  onPickImage: () => void
}) {
  // `aria` is the accessible name; the visible label is an icon or a short text
  // style name (H1/H2/H3). Toggle buttons expose aria-pressed; one-shot actions
  // (undo/redo, insert) opt out.
  const btn = (
    active: boolean,
    label: React.ReactNode,
    aria: string,
    onClick: () => void,
    opts: { title?: string; toggle?: boolean; disabled?: boolean } = {},
  ) => (
    <button
      type="button"
      className={`composer-btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={opts.title ?? aria}
      aria-label={aria}
      aria-pressed={opts.toggle === false ? undefined : active}
      disabled={opts.disabled}
    >
      {label}
    </button>
  )

  const currentFont = (editor.getAttributes('textStyle').fontFamily as string) ?? ''
  // fontSize comes back like "12pt"; strip the unit for the select's value.
  const currentSize = ((editor.getAttributes('textStyle').fontSize as string) ?? '').replace(
    /pt$/,
    '',
  )

  return (
    <div
      className="composer-toolbar"
      role="toolbar"
      aria-label="Text formatting"
      style={disabled ? { pointerEvents: 'none' } : undefined}
    >
      {btn(false, <UndoIcon size={15} />, 'Undo', () => editor.chain().focus().undo().run(), {
        toggle: false,
        disabled: !editor.can().undo(),
      })}
      {btn(false, <RedoIcon size={15} />, 'Redo', () => editor.chain().focus().redo().run(), {
        toggle: false,
        disabled: !editor.can().redo(),
      })}

      <span className="composer-sep" aria-hidden="true" />

      <select
        className="composer-select"
        title="Font"
        aria-label="Font family"
        value={currentFont}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v) editor.chain().focus().setFontFamily(v).run()
          else editor.chain().focus().unsetFontFamily().run()
        }}
      >
        <option value="">Font</option>
        {FONTS.map((f) => (
          <option key={f.label} value={f.value}>
            {f.label}
          </option>
        ))}
      </select>
      <select
        className="composer-select"
        title="Text size"
        aria-label="Text size"
        value={currentSize}
        onMouseDown={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value
          if (v) editor.chain().focus().setFontSize(`${v}pt`).run()
          else editor.chain().focus().unsetFontSize().run()
        }}
      >
        <option value="">Size</option>
        {SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <span className="composer-sep" aria-hidden="true" />

      {btn(
        editor.isActive('bold'),
        <BoldIcon size={15} />,
        'Bold',
        () => editor.chain().focus().toggleBold().run(),
        { title: 'Bold (⌘B)' },
      )}
      {btn(
        editor.isActive('italic'),
        <ItalicIcon size={15} />,
        'Italic',
        () => editor.chain().focus().toggleItalic().run(),
        { title: 'Italic (⌘I)' },
      )}
      {btn(
        editor.isActive('underline'),
        <UnderlineIcon size={15} />,
        'Underline',
        () => editor.chain().focus().toggleUnderline().run(),
        { title: 'Underline (⌘U)' },
      )}
      {btn(
        editor.isActive('strike'),
        <StrikethroughIcon size={15} />,
        'Strikethrough',
        () => editor.chain().focus().toggleStrike().run(),
        { title: 'Strikethrough' },
      )}

      <span className="composer-sep" aria-hidden="true" />

      {btn(editor.isActive('heading', { level: 1 }), 'H1', 'Heading 1', () =>
        editor.chain().focus().toggleHeading({ level: 1 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 2 }), 'H2', 'Heading 2', () =>
        editor.chain().focus().toggleHeading({ level: 2 }).run(),
      )}
      {btn(editor.isActive('heading', { level: 3 }), 'H3', 'Heading 3', () =>
        editor.chain().focus().toggleHeading({ level: 3 }).run(),
      )}

      <span className="composer-sep" aria-hidden="true" />

      {btn(editor.isActive({ textAlign: 'left' }), <AlignLeftIcon size={15} />, 'Align left', () =>
        editor.chain().focus().setTextAlign('left').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'center' }),
        <AlignCenterIcon size={15} />,
        'Align center',
        () => editor.chain().focus().setTextAlign('center').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'right' }),
        <AlignRightIcon size={15} />,
        'Align right',
        () => editor.chain().focus().setTextAlign('right').run(),
      )}
      {btn(
        editor.isActive({ textAlign: 'justify' }),
        <AlignJustifyIcon size={15} />,
        'Justify',
        () => editor.chain().focus().setTextAlign('justify').run(),
      )}

      <span className="composer-sep" aria-hidden="true" />

      {btn(editor.isActive('bulletList'), <ListIcon size={15} />, 'Bulleted list', () =>
        editor.chain().focus().toggleBulletList().run(),
      )}
      {btn(editor.isActive('orderedList'), <ListOrderedIcon size={15} />, 'Numbered list', () =>
        editor.chain().focus().toggleOrderedList().run(),
      )}
      {btn(editor.isActive('blockquote'), <QuoteIcon size={15} />, 'Block quote', () =>
        editor.chain().focus().toggleBlockquote().run(),
      )}

      <span className="composer-sep" aria-hidden="true" />

      {btn(
        linkOpen || editor.isActive('link'),
        <LinkIcon size={15} />,
        'Insert link',
        onToggleLink,
        { title: 'Insert link' },
      )}
      {btn(false, <ImageIcon size={15} />, 'Insert photo', onPickImage, {
        toggle: false,
        title: 'Insert photo (PNG/JPG, under 500 KB)',
      })}

      <span className="composer-sep" aria-hidden="true" />

      {btn(
        false,
        'Clear',
        'Remove formatting',
        () => editor.chain().focus().unsetAllMarks().clearNodes().run(),
        { toggle: false, title: 'Remove formatting' },
      )}
    </div>
  )
}
